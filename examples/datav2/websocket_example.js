"use strict";

const Alpaca = require("@alpacahq/alpaca-trade-api");
const API_KEY = "<YOUR_API_KEY>";
const API_SECRET = "<YOUR_API_SECRET>";

class DataStream {
  constructor({ apiKey, secretKey, feed }) {
    this.alpaca = new Alpaca({
      keyId: apiKey,
      secretKey: secretKey,
      feed: feed,
    });

    const socket = this.alpaca.data_stream_v2;

    socket.onConnect(function () {
      console.log("Connected");
      socket.subscribeForQuotes(["AAPL"]);
      socket.subscribeForTrades(["FB"]);
      socket.subscribeForBars(["SPY"]);
    });

    socket.onError((err) => {
      console.log(err);
    });

    socket.onStockTrade((trade) => {
      console.log(trade);
    });

    socket.onStockQuote((quote) => {
      console.log(quote);
    });

    socket.onStockBar((bar) => {
      console.log(bar);
    });

    socket.onStateChange((state) => {
      console.log(state);
    });

    socket.onDisconnect(() => {
      console.log("Disconnected");
    });

    socket.connect();
  }
}

let stream = new DataStream({
  apiKey: API_KEY,
  secretKey: API_SECRET,
  feed: "sip",
});
