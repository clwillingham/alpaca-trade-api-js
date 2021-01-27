"use strict";

const events = require("events");
const WebSocket = require("ws");
const entityv2 = require("./entityv2");

// Listeners
// A client can listen on any of the following events, states, or errors
// Connection states. Each of these will also emit EVENT.STATE_CHANGE
let STATE;
(function (STATE) {
  STATE.AUTHENTICATING = "authenticating";
  STATE.AUTHENTICATED = "authenticated";
  STATE.CONNECTED = "connected";
  STATE.CONNECTING = "connecting";
  STATE.DISCONNECTED = "disconnected";
  STATE.WAITING_TO_CONNECT = "waiting to connect";
  STATE.WAITING_TO_RECONNECT = "waiting to reconnect";
})((STATE = exports.STATE || (exports.STATE = {})));
// CLient events
let EVENT;
(function (EVENT) {
  EVENT.CLIENT_ERROR = "error";
  EVENT.STATE_CHANGE = "state change";
  EVENT.AUTHORIZED = "authorized";
  EVENT.UNAUTHORIZED = "unauthorized";
  EVENT.STOCK_TRADES = "stock_trades";
  EVENT.STOCK_QUOTES = "stock_quotes";
  EVENT.STOCK_BARS = "stock_bars";
})((EVENT = exports.EVENT || (exports.EVENT = {})));
// Connection errors
const CONN_ERROR = {
  400: "invalid syntax",
  401: "not authenticated",
  402: "auth failed",
  403: "already authenticated",
  404: "auth timeout",
  405: "symbol limit exceeded",
  406: "connection limit exceeded",
  407: "slow client",
  408: "v2 not enabled",
  500: "inteernal error",
  MISSING_SECERT_KEY: "missing secret key",
  MISSING_API_KEY: "missing api key",
  UNEXPECTED_MESSAGE: "unexpected message",
};

class AlpacaStreamV2Client extends events.EventEmitter {
  constructor(options = {}) {
    super();
    this.defaultOptions = {
      subscriptions: {
        trades: [],
        quotes: [],
        bars: [],
      },
      reconnect: true,
      // If true, client outputs detailed log messages
      verbose: options.verbose,
      // Reconnection backoff: if true, then the reconnection time will be initially
      // reconnectTimeout, then will double with each unsuccessful connection attempt.
      // It will not exceed maxReconnectTimeout
      backoff: true,
      // Initial reconnect timeout (seconds) a minimum of 1 will be used if backoff=false
      reconnectTimeout: 0,
      // The maximum amount of time between reconnect tries (applies to backoff)
      maxReconnectTimeout: 30,
      // The amount of time to increment the delay between each reconnect attempt
      backoffIncrement: 0.5,
    };

    this.session = Object.assign(this.defaultOptions, options);
    this.session.url =
      this.session.url.replace("https", "ws") +
      "/v2/stream/" +
      this.session.feed;

    if (this.session.apiKey.length === 0) {
      throw new Error(CONN_ERROR.MISSING_API_KEY);
    }
    if (this.session.secretKey.length === 0) {
      throw new Error(CONN_ERROR.MISSING_SECERT_KEY);
    }

    // it maybe unnecessary
    this.currentState = STATE.WAITING_TO_CONNECT;

    // Register internal event handlers
    // Log and emit every state change
    Object.keys(STATE).forEach((s) => {
      this.on(STATE[s], () => {
        this.currentState = STATE[s];
        this.emit(EVENT.STATE_CHANGE, STATE[s]);
      });
    });
  }

  onConnect(fn) {
    this.on(STATE.AUTHENTICATED, () => {
      fn();
      //if reconnected the user should subcribe to its symbols again
      this.subscribeAll();
    });
  }

  connect() {
    this.reconnectDisabled = false;
    this.emit(STATE.CONNECTING);
    this.currentState = STATE.CONNECTING;
    this.reconnect = false;
    this.conn = new WebSocket(this.session.url);
    this.conn.once("open", () => this.authenticate());
    this.conn.on("message", (data) => {
      this.log("info", data);
      this.handleMessage(data);
    });
    this.conn.once("close", () => {
      this.emit(STATE.DISCONNECTED);
      this.currentState = DISCONNECTED;
      if (this.session.reconnect && !this.reconnectDisabled) {
        this.reconnect();
      }
    });
  }

  reconnect() {
    setTimeout(() => {
      if (this.session.backoff) {
        this.session.reconnectTimeout += this.session.backoffIncrement;
        if (this.session.reconnectTimeout > this.session.maxReconnectTimeout) {
          this.session.reconnectTimeout = this.session.maxReconnectTimeout;
        }
      }
      this.connect();
    }, this.session.reconnectTimeout * 1000);
    this.emit(STATE.WAITING_TO_RECONNECT, this.session.reconnectTimeout);
  }

  subscribeForTrades(trades) {
    this.session.subscriptions.trades.push(...trades);
    this.subscribe(trades, [], []);
  }

  subscribeForQuotes(quotes) {
    this.session.subscriptions.quotes.push(...quotes);
    this.subscribe([], quotes, []);
  }

  subscribeForBars(bars) {
    this.session.subscriptions.bars.push(...bars);
    this.subscribe([], [], bars);
  }

  subscribe(trades, quotes, bars) {
    const subMsg = {
      action: "subscribe",
      trades: trades,
      quotes: quotes,
      bars: bars,
    };
    this.conn.send(JSON.stringify(subMsg));
  }

  subscribeAll() {
    if (
      this.session.subscriptions.trades.length > 0 ||
      this.session.subscriptions.quotes.length > 0 ||
      this.session.subscriptions.bars.length > 0
    ) {
      const msg = {
        action: "subscribe",
        trades: this.session.subscriptions.trades,
        quotes: this.session.subscriptions.quotes,
        bars: this.session.subscriptions.bars,
      };
      this.conn.send(JSON.stringify(msg));
    }
  }

  unsubscribeFromTrades(trades) {
    this.unsubscribe(trades, [], []);
  }

  unsubscribeFromQuotes(quotes) {
    this.unsubscribe([], quotes, []);
  }

  unsubscribeFromBars(bars) {
    this.unsubscribe([], [], bars);
  }

  unsubscribe(trades, quotes, bars) {
    const unsubMsg = {
      action: "unsubscribe",
      trades: trades,
      quotes: quotes,
      bars: bars,
    };
    this.conn.send(JSON.stringify(unsubMsg));
  }

  updateSubscriptions(msg) {
    this.log(
      "info",
      `listening to streams: 
        trades: ${msg.trades},
        quotes: ${msg.quotes},
        bars: ${msg.bars}`
    );
    this.session.subscriptions = {
      trades: msg.trades,
      quotes: msg.quotes,
      bars: msg.bars,
    };
  }

  onStockTrade(fn) {
    this.on(EVENT.STOCK_TRADES, (trade) => fn(trade));
  }

  onStockQuote(fn) {
    this.on(EVENT.STOCK_QUOTES, (quote) => fn(quote));
  }

  onStockBar(fn) {
    this.on(EVENT.STOCK_BARS, (bar) => fn(bar));
  }

  onError(fn) {
    this.on(EVENT.CLIENT_ERROR, (err) => fn(err));
  }

  onStateChange(fn) {
    this.on(EVENT.STATE_CHANGE, (newState) => fn(newState));
  }

  handleMessage(data) {
    const message = JSON.parse(data);
    let msgType;
    if ("T" in message[0]) {
      msgType = message[0].T;
    }
    if (msgType) {
      switch (msgType) {
        case "success":
          if (message[0].msg === "authenticated") {
            this.session.authenticated = true;
            this.emit(STATE.AUTHENTICATED);
            this.currentState = STATE.AUTHENTICATED;
          } else if (message[0].msg === "connected") {
            this.emit(STATE.CONNECTED);
          }
          break;
        case "subscription":
          this.updateSubscriptions(message[0]);
          break;
        case "error":
          this.emit(EVENT.CLIENT_ERROR, CONN_ERROR[message[0].code]);
          break;
        default:
          this.dataHandler(message);
      }
    }
  }

  dataHandler(data) {
    data.forEach((element) => {
      if ("T" in element) {
        switch (element.T) {
          case "t":
            this.emit(EVENT.STOCK_TRADES, entityv2.AlpacaTradeV2(element));
            break;
          case "q":
            this.emit(EVENT.STOCK_QUOTES, entityv2.AlpacaQuoteV2(element));
            break;
          case "b":
            this.emit(EVENT.STOCK_BARS, entityv2.AlpacaBarV2(element));
            break;
          default:
            this.emit(EVENT.CLIENT_ERROR, CONN_ERROR.UNEXPECTED_MESSAGE);
        }
      }
    });
  }

  authenticate() {
    this.emit(STATE.AUTHENTICATING);
    this.currentState = STATE.AUTHENTICATING;

    const authMsg = {
      action: "auth",
      key: this.session.apiKey,
      secret: this.session.secretKey,
    };

    this.conn.send(JSON.stringify(authMsg));
  }

  onDisconnect(fn) {
    this.on(EVENT.DISCONNECTED, () => fn());
  }

  disonnect() {
    this.reconnectDisabled = true;
    this.emit(EVENT.DISCONNECTED);
    this.currentState = STATE.DISCONNECTED;
    this.conn.close();
  }

  log(level, ...msg) {
    if (this.session.verbose) {
      console[level](...msg);
    }
  }
}

module.exports = {
  AlpacaStreamV2Client: AlpacaStreamV2Client,
};