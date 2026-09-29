// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Logger = require('../../Core/Logger');
const { Builder, GetU32, GetU64, GetString8, DateToVCDate } = require('../../Codec/FieldList');
const C = require('./Fields');

const EndpointIds = Object.freeze([0x8c8b8bf4]);

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Owner = (GetString8(Fields, C.Gamertag) || Context.gamertag || '').trim();
    const RequestUserId = GetU64(Fields, C.UserId);
    const AccountId = RequestUserId !== null && RequestUserId !== 0n ? RequestUserId : (Context.userId ?? 0n);
    const FileType = GetU32(Fields, C.FileType) || C.UserData;
    const Wanted = GetString8(Fields, C.FileName) || '';
    const Maximum = Math.max(1, Math.min(Number(GetU64(Fields, C.MaxResults) ?? 1n), 100));
    let Entries = AccountId === 0n ? [] : Context.content.List(AccountId, FileType);
    if (Wanted) Entries = Entries.filter((Entry) => Entry.fileName === Wanted);
    const Shown = Entries.slice(0, Maximum);
    const Reply = new Builder().AddU64(C.CountObserved, BigInt(Shown.length));
    for (const Entry of Shown) {
        Reply.AddBool(C.MoreAvailable, Entries.length > Shown.length)
            .AddString8(C.Gamertag, Entry.ownerName || Owner)
            .AddU64(C.EntryA, 0n)
            .AddU64(C.UserId, BigInt(`0x${Entry.userId}`))
            .AddU64(C.EntryB, 0n)
            .AddU64(C.FileId, Entry.fileId)
            .AddU64(C.TitleId, 0n)
            .AddString8(C.Description, Entry.description || Entry.fileName)
            .AddString8(C.EntryC, '')
            .AddString8(C.FileName, Entry.fileName)
            .AddString8(C.FilePath, '')
            .AddU64(C.Rating, BigInt(Entry.rating || 0))
            .AddU64(C.EntryD, 0n)
            .AddU64(C.DataSize, BigInt(Entry.size))
            .AddU64(C.EntryE, 0n)
            .AddU64(C.NumDownloads, BigInt(Entry.downloads || 0))
            .AddVCDate(C.EntryDate, DateToVCDate(Entry.modified));
    }
    Reply.AddU32(C.Result, C.Success);
    Logger.Info(
        `listed ${Shown.length} stored item(s) for ${Owner || 'unknown user'} (${AccountId.toString(16).toUpperCase()}), file type 0x${FileType.toString(16).toUpperCase()}`,
    );
    return Reply.Build();
}

module.exports = { Build, List: Build, EndpointIds, Status: 'REAL_2K19_IDA_ID_PLUS_CAPTURED_WIRE' };
