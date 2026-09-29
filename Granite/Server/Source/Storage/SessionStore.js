// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('node:crypto');
const Fs = require('node:fs');
const Path = require('node:path');

class SessionStore {
    constructor(Directory) {
        this.Directory = Path.resolve(Directory);
        this.Sessions = new Map();
        Fs.mkdirSync(this.Directory, { recursive: true });
        this.#Load();
    }

    #Load() {
        for (const File of Fs.readdirSync(this.Directory, { withFileTypes: true })) {
            if (!File.isFile() || !File.name.endsWith('.json')) continue;
            try {
                const Item = JSON.parse(Fs.readFileSync(Path.join(this.Directory, File.name), 'utf8'));
                if (Item && Item.key) this.Sessions.set(String(Item.key), Item);
            } catch {}
        }
    }

    #Write(Item) {
        const File = Path.join(this.Directory, `${Item.key}.json`);
        Fs.writeFileSync(File, `${JSON.stringify(Item, null, 2)}\n`, 'utf8');
    }

    Create(Identity = {}) {
        let Key;
        do {
            Key = Crypto.randomBytes(8).readBigUInt64BE(0) & 0x7fffffffffffffffn;
        } while (Key === 0n || this.Sessions.has(Key.toString()));
        const Item = {
            key: Key.toString(),
            userId:
                Identity.userId === null || Identity.userId === undefined ? null : BigInt(Identity.userId).toString(),
            gamertag: String(Identity.gamertag || ''),
            verified: Boolean(Identity.verified),
            platformUserId:
                Identity.platformUserId === null || Identity.platformUserId === undefined
                    ? null
                    : BigInt(Identity.platformUserId).toString(),
            celestialUserId:
                Identity.celestialUserId === null || Identity.celestialUserId === undefined
                    ? null
                    : String(Identity.celestialUserId),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.Sessions.set(Item.key, Item);
        this.#Write(Item);
        return { ...Item, key: Key };
    }

    get(Key) {
        if (Key === null || Key === undefined || Key === '') return null;
        const Item = this.Sessions.get(String(Key));
        if (!Item) return null;
        Item.updatedAt = new Date().toISOString();
        this.#Write(Item);
        return { ...Item, key: BigInt(Item.key), userId: Item.userId === null ? null : BigInt(Item.userId) };
    }

    bind(Key, Identity = {}) {
        const Item = this.Sessions.get(String(Key));
        if (!Item) return null;
        if (!Item.verified && Identity.userId !== null && Identity.userId !== undefined) {
            const UserId = BigInt(Identity.userId);
            if (UserId !== 0n) Item.userId = UserId.toString();
        }
        if (Identity.gamertag) Item.gamertag = String(Identity.gamertag);
        if (Identity.careerSlot !== null && Identity.careerSlot !== undefined && String(Identity.careerSlot) !== '') {
            Item.careerSlot = String(Identity.careerSlot);
        }
        if (
            Identity.careerScopeId !== null &&
            Identity.careerScopeId !== undefined &&
            String(Identity.careerScopeId) !== ''
        ) {
            Item.careerScopeId = String(Identity.careerScopeId);
        }
        Item.updatedAt = new Date().toISOString();
        this.#Write(Item);
        return this.get(Key);
    }
}

module.exports = { SessionStore };
