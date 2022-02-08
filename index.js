const axios = require("axios");
const fs = require("fs");
const { env } = require("process");
const util = require("util");

const quote = "USDT";
const getBinanceExchangeInfo = axios.get(
    "https://api.binance.com/api/v1/exchangeInfo"
);
const getCoinMarketCapList = axios.get(
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest", {
        params: {
            start: 1,
            limit: 1500,
            sort: "market_cap",
            sort_dir: "desc"
        },
        headers: {
            "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
        },
    }
);

// Start
(async () => {
    await axios
        .all([getBinanceExchangeInfo, getCoinMarketCapList])
        .then(
            axios.spread((...responses) => {
                const binanceExchangeInfo = responses[0];
                const coinMarketCapList = responses[1];

                console.info(
                    "Binance API response code: %s, CoinMarketCap API response code: %s",
                    binanceExchangeInfo.status,
                    coinMarketCapList.status
                );

                if (binanceExchangeInfo.status != 200 || coinMarketCapList.status != 200) {
                    console.error("Received unexpected responses.");
                } else {
                    generateWatchlist(binanceExchangeInfo, coinMarketCapList);
                }
            })
        )
        .catch((errors) => {
            console.error(errors);
        });
})();

function generateWatchlist(binanceExchangeInfo, coinMarketCapList) {
    let justUSDTpairs = getCoinPairs(binanceExchangeInfo, coinMarketCapList);
    let watchlist = [];

    console.info('Total SPOT tradable coin pairs: %d', justUSDTpairs.length);

    for (let i = 10; i <= 1500; i = i + 10) {
        let coinPairs = justUSDTpairs.filter(
            (p) => p.cmcRank > i - 10 && p.cmcRank <= i
        );

        if (coinPairs.length == 0) {
            console.info('There is not any coin in the ranks from %d to %d', i - 9, i);
            continue;
        }

        let section = util.format("###CoinMarketCap Ranks: %d-%d", i - 9, i);
        watchlist.push(section);

        coinPairs.sort((c1, c2) => c1.cmcRank - c2.cmcRank);
        coinPairs.forEach((c) => {
            item = util.format("BINANCE:%s", c.symbol);
            watchlist.push(item);
        });
    }

    //console.debug(watchlist);

    fs.writeFileSync(getFilename(), watchlist.join(","));
    console.info("Binance watchlist for Tradingview was generated successfully.")
}

function getCoinPairs(binanceExchangeInfo, coinMarketCapList) {
    return binanceExchangeInfo.data.symbols
        .map(symbol => {
            if (symbol.quoteAsset.includes(quote)
                && symbol.permissions.includes('SPOT')
                && symbol.status === "TRADING") {
                let baseAsset = symbol.baseAsset;
                // Symbol name hack. Symbols in Binance are IOTA and GXS
                // but in CMC are MIOTA and GXC respectively
                if (symbol.baseAsset === "IOTA") {
                    baseAsset = "MIOTA";
                } else if (symbol.baseAsset === "GXS") {
                    baseAsset = "GXC";
                }

                let cmcData = coinMarketCapList.data.data.filter((data) => {
                    return data.symbol === baseAsset;
                });

                //console.debug(cmcData);
                if (!cmcData || cmcData.length == 0) {
                    console.error(
                        "%s does not exist in CoinMarketCap response",
                        symbol.baseAsset
                    );
                    return null;
                } else {
                    //console.debug("Symbol: %s, Rank: %d", symbol.baseAsset, cmcData[0].cmc_rank);
                    return {
                        symbol: symbol.symbol,
                        cmcRank: cmcData[0].cmc_rank
                    };
                }
            }
        })
        .filter(symbol => {
            if (symbol) {
                return symbol;
            }
        });
}

function getFilename() {
    let date_ob = new Date();
    // current date
    // adjust 0 before single digit date
    let date = ("0" + date_ob.getDate()).slice(-2);
    // current month
    let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
    // current year
    let year = date_ob.getFullYear();

    return util.format("binance_watchlist_%s-%s-%s.txt", date, month, year);
}