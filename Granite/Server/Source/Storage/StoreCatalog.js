// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');

function LoadCatalogPrices(File) {
    const Document = JSON.parse(Fs.readFileSync(File, 'utf8'));
    if (
        Document.version !== 1 ||
        Document.source !== 'NBA2K19_MANIFEST_STORE_BINARY_DATA' ||
        !Array.isArray(Document.items)
    )
        throw new Error('store prices require an exported NBA2K19 item catalog');
    const Prices = new Map();
    for (const Entry of Document.items) {
        const Item = Number(Entry.item) >>> 0;
        const Price = Number(Entry.finalPrice ?? Entry.price);
        if (!Item || !Number.isSafeInteger(Price) || Price <= 0) continue;
        Prices.set(Item, BigInt(Price));
    }
    return Prices;
}

module.exports = { LoadCatalogPrices };
