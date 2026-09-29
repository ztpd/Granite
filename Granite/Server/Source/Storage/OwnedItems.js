// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const Logger = require('../Core/Logger');
const { NormalizeUserId } = require('./ContentStore');

function OwnedKey(Context) {
    const UserId = Context?.userId;
    if (UserId === null || UserId === undefined) return null;
    try {
        return NormalizeUserId(UserId);
    } catch {
        return null;
    }
}

function NormalizeEntry(Entry) {
    if (!Entry || typeof Entry !== 'object') return null;
    const Item = Number(Entry.item) >>> 0;
    if (!Number.isFinite(Item)) return null;
    return {
        item: `0x${Item.toString(16).toUpperCase().padStart(8, '0')}`,
        purchaseType:
            Entry.purchaseType === null || Entry.purchaseType === undefined
                ? null
                : `0x${(Number(Entry.purchaseType) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
        price: String(Entry.price ?? 0n),
        at: typeof Entry.at === 'string' && Entry.at ? Entry.at : new Date(0).toISOString(),
    };
}

function LoadOwnedItems(File) {
    try {
        const Raw = JSON.parse(Fs.readFileSync(File, 'utf8'));
        const Owned = new Map();
        if (Raw && typeof Raw === 'object' && !Array.isArray(Raw)) {
            for (const [Key, Value] of Object.entries(Raw)) {
                if (!Array.isArray(Value)) continue;
                const Entries = Value.map(NormalizeEntry).filter(Boolean);
                Owned.set(String(Key), Entries);
            }
        }
        return Owned;
    } catch (Failure) {
        if (Failure.code !== 'ENOENT') Logger.Verbose(`owned items unavailable: ${Failure.message}`);
        return new Map();
    }
}

function SaveOwnedItems(File, Owned) {
    if (!(Owned instanceof Map)) return;
    const Output = {};
    for (const [Key, Entries] of Owned.entries()) {
        if (!Array.isArray(Entries)) continue;
        Output[String(Key)] = Entries.map(NormalizeEntry).filter(Boolean);
    }
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    Fs.writeFileSync(Temporary, `${JSON.stringify(Output, null, 2)}\n`, 'utf8');
    Fs.renameSync(Temporary, File);
}

function RememberOwnedItem(
    Owned,
    AccountKey,
    { item: Item, purchaseType: PurchaseType = null, price: Price = 0n, at: At = null } = {},
) {
    if (!(Owned instanceof Map) || !AccountKey) return false;
    const ItemId = Number(Item) >>> 0;
    if (!Number.isFinite(ItemId) || ItemId === 0) return false;
    const List = Owned.get(String(AccountKey)) || [];
    const Record = NormalizeEntry({
        item: ItemId,
        purchaseType: PurchaseType,
        price: typeof Price === 'bigint' ? String(Price) : Price,
        at: At || new Date().toISOString(),
    });
    const Existing = List.findIndex((Entry) => Entry.item === Record.item);
    if (Existing >= 0) {
        List[Existing] = Record;
    } else {
        List.push(Record);
    }
    Owned.set(String(AccountKey), List);
    return true;
}

function ListOwnedItems(Owned, AccountKey) {
    if (!(Owned instanceof Map) || !AccountKey) return [];
    const List = Owned.get(String(AccountKey));
    return Array.isArray(List) ? List : [];
}

module.exports = {
    OwnedKey,
    NormalizeEntry,
    LoadOwnedItems,
    SaveOwnedItems,
    RememberOwnedItem,
    ListOwnedItems,
};
