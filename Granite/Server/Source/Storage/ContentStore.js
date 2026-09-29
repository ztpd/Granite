// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('node:crypto');
const Fs = require('node:fs');
const Path = require('node:path');
const { U32, Hex32 } = require('../Core/Crc32');

function AtomicJson(File, Value) {
    const Temporary = `${File}.${process.pid}.${Date.now()}.tmp`;
    Fs.writeFileSync(Temporary, `${JSON.stringify(Value, null, 2)}\n`, 'utf8');
    Fs.renameSync(Temporary, File);
}

function NormalizeUserId(Value) {
    const Text = typeof Value === 'string' ? Value.trim() : '';
    const NumberValue = BigInt.asUintN(64, /^[0-9A-F]{16}$/i.test(Text) ? BigInt(`0x${Text}`) : BigInt(Value));
    return NumberValue.toString(16).toUpperCase().padStart(16, '0');
}

function FileIdFor(AccountId, FileType, FileName) {
    const Key = `${NormalizeUserId(AccountId)}|${Hex32(FileType)}|${String(FileName)}`;
    const Id = Crypto.createHash('sha256').update(Key).digest().readBigUInt64BE(0);
    return Id === 0n ? 1n : Id;
}

class ContentStore {
    constructor(Root) {
        this.Root = Path.resolve(Root);
        this.IndexPath = Path.join(this.Root, 'index.json');
        Fs.mkdirSync(this.Root, { recursive: true });
        this.entries = this.#Load();
    }

    #Load() {
        if (!Fs.existsSync(this.IndexPath)) return [];
        try {
            const Value = JSON.parse(Fs.readFileSync(this.IndexPath, 'utf8'));
            return Array.isArray(Value.entries) ? Value.entries : [];
        } catch {
            const Backup = `${this.IndexPath}.corrupt.${Date.now()}`;
            Fs.copyFileSync(this.IndexPath, Backup);
            return [];
        }
    }

    #Persist() {
        AtomicJson(this.IndexPath, { version: 3, entries: this.entries });
    }

    Save({
        accountId: AccountId,
        ownerName: OwnerName = '',
        fileType: FileType,
        fileName: FileName = 'USERDATA',
        description: Description = '',
        Payload,
    }) {
        if (!Buffer.isBuffer(Payload)) throw new TypeError('payload must be a Buffer');
        const Account = NormalizeUserId(AccountId);
        if (Account === '0000000000000000') throw new TypeError('authenticated account id is required');
        const DisplayName = String(OwnerName || '').trim() || 'Unknown';
        const Type = U32(FileType);
        const Id = FileIdFor(Account, Type, FileName);
        const Relative = Path.join(
            Account,
            Hex32(Type).slice(2),
            `${Id.toString(16).toUpperCase().padStart(16, '0')}.bin`,
        );
        const Absolute = Path.join(this.Root, Relative);
        Fs.mkdirSync(Path.dirname(Absolute), { recursive: true });
        Fs.writeFileSync(Absolute, Payload);
        const Entry = {
            fileId: Id.toString(),
            accountId: Account,
            ownerName: DisplayName,
            userId: Account,
            fileType: Type,
            fileName: String(FileName),
            description: String(Description || ''),
            relativePath: Relative.replaceAll('\\', '/'),
            size: Payload.length,
            modified: new Date().toISOString(),
            downloads: 0,
            rating: 0,
        };
        const At = this.entries.findIndex((Item) => Item.fileId === Entry.fileId);
        if (At >= 0) this.entries[At] = { ...this.entries[At], ...Entry };
        else this.entries.push(Entry);
        this.#Persist();
        return { ...Entry, fileId: Id, Bytes: Buffer.from(Payload) };
    }

    List(AccountId, FileType) {
        const Account = NormalizeUserId(AccountId);
        const Type = U32(FileType);
        return this.entries
            .filter((Entry) => Entry.accountId === Account && U32(Entry.fileType) === Type)
            .filter((Entry) => {
                const Absolute = Path.resolve(this.Root, Entry.relativePath);
                return Absolute.startsWith(`${this.Root}${Path.sep}`) && Fs.existsSync(Absolute);
            })
            .map((Entry) => ({ ...Entry, fileId: BigInt(Entry.fileId) }));
    }

    FindAnyById(FileId) {
        const Id = BigInt.asUintN(64, BigInt(FileId));
        const Entry = this.entries.find((Item) => BigInt(Item.fileId) === Id);
        if (!Entry) return null;
        const Absolute = Path.resolve(this.Root, Entry.relativePath);
        if (!Absolute.startsWith(`${this.Root}${Path.sep}`) || !Fs.existsSync(Absolute)) return null;
        const Bytes = Fs.readFileSync(Absolute);
        Entry.downloads = Number(Entry.downloads || 0) + 1;
        this.#Persist();
        return { ...Entry, fileId: Id, Bytes };
    }

    FindById(FileId, AccountId) {
        const Id = BigInt.asUintN(64, BigInt(FileId));
        const Entry = this.entries.find((Item) => BigInt(Item.fileId) === Id);
        if (!Entry) return null;
        if (Entry.accountId !== NormalizeUserId(AccountId)) return null;
        const Absolute = Path.resolve(this.Root, Entry.relativePath);
        if (!Absolute.startsWith(`${this.Root}${Path.sep}`) || !Fs.existsSync(Absolute)) return null;
        const Bytes = Fs.readFileSync(Absolute);
        Entry.downloads = Number(Entry.downloads || 0) + 1;
        this.#Persist();
        return { ...Entry, fileId: Id, Bytes };
    }
}

module.exports = { ContentStore, FileIdFor, NormalizeUserId };
