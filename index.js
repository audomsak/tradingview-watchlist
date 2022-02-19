"use strict";

const axios = require("axios");
const fs = require("fs");
const util = require("util");
const Bottleneck = require('bottleneck');

// CoinMarketCap API free plan has API call rate limit at 30 requests a minute
// So, need to use limiter for throttling
const limiter = new Bottleneck({
    minTime: 2500, //minimum time (millisecond) between requests
    maxConcurrent: 1 //maximum concurrent requests
});

const quote = "USDT"; // A coin to be used as a coin pair. Can be chaged to i.e. USD, BNB, BTC
const isSectioningWithCmcRank = true;
const cmcCoinListLimit = 1500; // Maximum rank to be retrieved from CoinMarketCap

const date = new Date();
const dateStr = util.format("%s-%s-%s", ("0" + date.getDate()).slice(-2),
    ("0" + (date.getMonth() + 1)).slice(-2), date.getFullYear());

// Public available in CoinMarketCap (coinmarketcap.com) website so no need to hide
const cmcSandboxApiKey = "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c";
const cmcProdApiKey = process.env.CMC_API_KEY;
const cmcApiKey = cmcProdApiKey;

const cmcProBaseUrl = "https://pro-api.coinmarketcap.com";
const cmcSandBoxBaseUrl = "https://sandbox-api.coinmarketcap.com";
const binanceExchangeInfoUrl = "https://api.binance.com/api/v1/exchangeInfo";
const cmcBaseUrl = cmcProBaseUrl;

const cmcHttpRequestHeader = {"X-CMC_PRO_API_KEY": cmcApiKey};
const cmcCategoryApiUrl = util.format("%s/v1/cryptocurrency/category", cmcBaseUrl);
const cmcCategoriesApiUrl = util.format("%s/v1/cryptocurrency/categories", cmcBaseUrl);
const cmcCryptoListingApiUrl = util.format("%s/v1/cryptocurrency/listings/latest", cmcBaseUrl);

// Entrypoint
(async () => await main())();

async function main() {
    console.info("Attention!!! The process will take time to finish due to CoinMarketCap API " +
        "free plan has API call rate limit at 30 requests a minute.\n");
    console.info("Start generating watchlists for TradingView...\n");

    // Delete (if exists) and re-create output directory
    let dir = __dirname + "/output";
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, {recursive: true});
    }
    fs.mkdirSync(dir, {recursive: true});

    await Promise.all([
        axios.get(binanceExchangeInfoUrl),
        limiter.schedule(() => axios.get(cmcCategoriesApiUrl, {
            headers: cmcHttpRequestHeader,
        })),
        limiter.schedule(() => axios.get(cmcCryptoListingApiUrl, {
            params: {
                start: 1,
                limit: cmcCoinListLimit,
                sort: "market_cap",
                sort_dir: "desc",
            },
            headers: cmcHttpRequestHeader
        }))
    ]).then(axios.spread((...responses) => {
            const binanceExchangeInfoResp = responses[0];
            const cmcCryptoCategoriesResp = responses[1];
            const cmcCryptoListingResp = responses[2];

            if (binanceExchangeInfoResp.status === 200
                && cmcCryptoListingResp.status === 200
                && cmcCryptoCategoriesResp.status === 200) {

                console.info("1). Generating general watchlists...\n");
                generateWatchlist(binanceExchangeInfoResp.data, cmcCryptoListingResp.data);

                console.info("\n2). Generating watchlists for each category...\n")
                generateCategorizedWatchlist(binanceExchangeInfoResp.data, cmcCryptoCategoriesResp.data);
            } else {
                console.error("Received unexpected responses.");
            }
        })
    ).catch(errors => console.error(errors));
}

async function generateWatchlist(binanceExchangeInfo, coinMarketCapList) {
    let justUSDTpairs = getCoinPairs(binanceExchangeInfo, coinMarketCapList);
    let watchlist = [];

    console.info("Total SPOT tradable coin pairs: %d", justUSDTpairs.length);

    for (let i = 10; i <= cmcCoinListLimit; i = i + 10) {
        let coinPairs = justUSDTpairs.filter(p => p.cmcRank > i - 10 && p.cmcRank <= i);
        if (coinPairs.length === 0) {
            //console.debug("There is not any coin in the ranks from %d to %d", i - 9, i);
            continue;
        }

        if (isSectioningWithCmcRank) {
            let section = util.format("###CoinMarketCap Ranks %d-%d", i - 9, i);
            watchlist.push(section);
        }

        coinPairs.sort((c1, c2) => c1.cmcRank - c2.cmcRank);
        coinPairs.forEach(c => {
            let item = util.format("BINANCE:%s", c.symbol);
            watchlist.push(item);
        });
    }

    //console.debug(watchlist);

    // Write watchlist file with sections based on ranks in CoinMarketCap
    fs.writeFileSync(getFilename(isSectioningWithCmcRank), watchlist.join(","));
    // Write watchlist file WITHOUT the sections
    fs.writeFileSync(getFilename(!isSectioningWithCmcRank), watchlist.filter(w => !w.startsWith("###")).join(","));

    console.info("Watchlists for TradingView were generated successfully.");
}

async function generateCategorizedWatchlist(binanceExchangeInfo, cmcCategories) {
    Promise.all(cmcCategories.data.map(category =>
        limiter.schedule(() => axios.get(cmcCategoryApiUrl, {
            params: {
                id: category.id
            },
            headers: cmcHttpRequestHeader
        }))
    )).then(axios.spread((...cmcCategoryResponses) =>
        cmcCategoryResponses.forEach(cmcCategoryResp => {
            if (cmcCategoryResp.status === 200) {
                generateWatchlistForCategory(cmcCategoryResp.data, binanceExchangeInfo)
            } else {
                console.error("Received unexpected responses.");
            }
        })
    )).catch(errors => console.error(errors));
}

async function generateWatchlistForCategory(cmcCategory, binanceExchangeInfo) {
    const categoryName = cmcCategory.data.name;

    console.info("\nGenerating watchlist for the %s category...\nCategory name: %s\nDescription: %s",
        categoryName, categoryName, cmcCategory.data.description)

    const coins = cmcCategory.data.coins.map((coin) => {
        let symbol = coin.symbol;
        // Symbol name hack. Symbols in Binance are IOTA and GXS
        // but in CMC are MIOTA and GXC respectively
        if (symbol === "MIOTA") {
            symbol = "IOTA";
        } else if (symbol === "GXC") {
            symbol = "GXS";
        }

        const isSpotTradable = binanceExchangeInfo.symbols.some(s =>
            s.baseAsset === symbol &&
            s.quoteAsset.includes(quote) &&
            s.permissions.includes("SPOT") &&
            s.status === "TRADING"
        );

        if (isSpotTradable) {
            return {
                symbol: util.format("%s%s", coin.symbol, quote),
                cmcRank: coin.cmc_rank
            };
        }
    }).filter(symbol => {
        if (symbol) {
            return symbol;
        }
    });

    if (coins.length === 0) {
        console.warn("There is not any coin in the %s category can be traded in Binance", categoryName);
    } else {
        coins.sort((c1, c2) => c1.cmcRank - c2.cmcRank);
        let watchlist = coins.map(c => util.format("BINANCE:%s", c.symbol));

        fs.writeFileSync(getCategorizedFilename(categoryName), watchlist.join(","));
        console.info("%s category watchlist for TradingView was generated successfully.", categoryName);
    }
}

function getCoinPairs(binanceExchangeInfo, coinMarketCapList) {
    return binanceExchangeInfo.symbols
        .map(symbol => {
            if (symbol.quoteAsset.includes(quote)
                && symbol.permissions.includes("SPOT")
                && symbol.status === "TRADING") {

                let baseAsset = symbol.baseAsset;

                // Symbol name hack. Symbols in Binance are IOTA and GXS
                // but in CMC are MIOTA and GXC respectively
                if (symbol.baseAsset === "IOTA") {
                    baseAsset = "MIOTA";
                } else if (symbol.baseAsset === "GXS") {
                    baseAsset = "GXC";
                }

                let cmcData = coinMarketCapList.data.filter(data => {
                    return data.symbol === baseAsset;
                });

                //console.debug(cmcData);
                if (!cmcData || cmcData.length === 0) {
                    console.error("%s does not exist in CoinMarketCap response", symbol.baseAsset);
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

function getFilename(withSection) {
    let section = withSection ? "with_section" : "without_section";
    return util.format("%s/output/binance_watchlist_%s_on_%s.txt", __dirname, section, dateStr);
}

function getCategorizedFilename(category) {
    let categoryName = category.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "").replace(/ /g, "_");
    return util.format("%s/output/categorized/binance_watchlist_%s_category_on_%s.txt", __dirname, categoryName, dateStr);
}
