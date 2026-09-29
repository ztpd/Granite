// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Logger = require('../../Core/Logger');
const { Builder, GetU64, GetString8 } = require('../../Codec/FieldList');
const C = require('./Fields');

const EndpointIds = Object.freeze([0xca7a1109]);
const NotFound = 0x8af724b8;

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Owner = (GetString8(Fields, C.Gamertag) || Context.gamertag || '').trim();
    const RequestUserId = GetU64(Fields, C.UserId);
    const AccountId = RequestUserId !== null && RequestUserId !== 0n ? RequestUserId : (Context.userId ?? 0n);
    const Requested = GetU64(Fields, C.FileId);
    let Hit = Requested === null || AccountId === 0n ? null : Context.content.FindById(Requested, AccountId);
    if (!Hit && Requested !== null && typeof Context.content.FindAnyById === 'function') {
        Hit = Context.content.FindAnyById(Requested);
    }
    const Reply = new Builder();
    if (!Hit) {
        Logger.Verbose(
            `download id ${Requested === null ? 'missing' : Requested.toString(16).toUpperCase()} not found for account ${AccountId.toString(16).toUpperCase()}`,
        );
        if (Context.userId !== null && Context.userId !== undefined) {
            Reply.AddU64(C.UserId, Context.userId);
        }
        if (Requested !== null) Reply.AddU64(C.FileId, Requested);
        return Reply.AddU64(C.DataSize, 0n).AddU32(C.Result, NotFound).Build();
    }
    let Payload = Hit.Bytes;
    if (Hit.fileType === C.UserData || String(Hit.fileName).toUpperCase() === 'USERDATA') {
        const Bundle = require('./Upload').ExactUserDataBundle(Payload);
        if (Bundle) Payload = Bundle;
    }
    Reply.AddU64(C.UserId, BigInt(`0x${Hit.userId}`))
        .AddU64(C.FileId, Hit.fileId)
        .AddString8(C.FileName, Hit.fileName)
        .AddU64(C.DataSize, BigInt(Payload.length))
        .AddU64(C.ExtraDataSize, BigInt(Payload.length))
        .AddU32(C.Result, C.Success)
        .AlignData(8);
    Logger.Info(
        `serving ${Hit.fileName} for ${Owner || Hit.ownerName} (${Hit.accountId}), ${Payload.length} bytes, file id ${Hit.fileId.toString(16).toUpperCase()}`,
    );
    return Reply.Build({ Trailing: Payload });
}

module.exports = {
    Build,
    Download: Build,
    EndpointIds,
    NotFound,
    ExpectedEmptyResult: NotFound,
    Status: 'REAL_2K19_IDA_ID_PLUS_CAPTURED_WIRE',
};
