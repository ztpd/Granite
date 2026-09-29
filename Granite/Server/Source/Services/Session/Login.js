// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Zlib = require('node:zlib');
const Logger = require('../../Core/Logger');
const { Crc32, U32 } = require('../../Core/Crc32');
const { Builder, Types, GetU32, GetU64, GetString8, DateToVCDate } = require('../../Codec/FieldList');

const Crcs = Object.freeze({
    UserId: Crc32('USERID'),
    GamertagLogin: 0x3e6d9a3b,
    Gamertag: Crc32('GAMERTAG'),
    Result: Crc32('RESULT'),
    Success: Crc32('SUCCESS'),
    AccessDenied: Crc32('ACCESS_DENIED'),
    SessionKey: Crc32('SESSION_KEY'),
    ManifestTimestamp: 0x93f13b2d,
    Services: 0xb5017d25,
    Manifest: 0xdd831c7a,
    Parameters: 0x7f907735,
    LockstepDelaySeconds: 0xfb1c4cf3,
    ServerTime: 0xe9824107,
    IssuedAt: 0x329a965f,
    Environment: 0x517c7ed8,
    SkuId: 0xcff900a4,
});

const Exact2K19 = Object.freeze({
    SessionRootUrl: 'https://nba2k19-ws.2ksports.com:19217/Session',
    OriginalSessionPort: 19217,
    GraniteRedirectPort: 21000,
    LoginPath: '/login',
    UpdatePath: '/update',
    Method: 'POST',
    TitleId: 0x0000801e,
    SkuSelector: 0xd52e6eb0,
});

function Gzip(Bytes) {
    return Zlib.gzipSync(Bytes, { level: 9, Mtime: 0 });
}

function AddJsonRecord(ListBuilder, Record) {
    const Type = String(Record.Type || '').toUpperCase();
    if (Type === 'STRING8') return ListBuilder.AddString8(Record.Crc, Record.Value);
    if (Type === 'FLOAT' || Type === 'F32') return ListBuilder.AddF32(Record.Crc, Record.Value);
    if (Type === 'PACKED') return ListBuilder.AddPacked(Record.Crc, Record.Value);
    if (Type === 'U64') return ListBuilder.AddU64(Record.Crc, Record.Value);
    if (Type === 'BOOL') return ListBuilder.AddBool(Record.Crc, Record.Value);
    return ListBuilder.AddU32(Record.Crc, Record.Value);
}

function BuildEndpointBlob(File) {
    if (!File || !Fs.existsSync(File)) {
        Logger.Error(`NBA2K19 endpoint table is missing: ${File}`);
        return Gzip(new Builder().Build().Body);
    }
    const Document = JSON.parse(Fs.readFileSync(File, 'utf8'));
    if (!Array.isArray(Document.Endpoints)) throw new Error('endpoint table has no Endpoints array');
    const Seen = new Set();
    const ListBuilder = new Builder();
    for (const Endpoint of Document.Endpoints) {
        const Id = U32(Endpoint.EndpointId);
        if (Seen.has(Id)) throw new Error(`duplicate endpoint id ${Endpoint.EndpointId}`);
        Seen.add(Id);
        if (!Array.isArray(Endpoint.Records) || Endpoint.Records.length !== 14) {
            throw new Error(`endpoint row ${Endpoint.Row} must contain exactly 14 records`);
        }
        for (const Source of Endpoint.Records) {
            const Record = { ...Source };
            const Key = U32(Record.Crc);
            if (Key === 0xc493acfe) Record.Value = Endpoint.EndpointId;
            else if (Key === 0x12bbf3ab) Record.Value = Endpoint.Url;
            else if (Key === 0xa78a16c7) Record.Value = Endpoint.Method;
            else if (Key === 0xbfb467cc) Record.Value = Endpoint.CategoryId;
            AddJsonRecord(ListBuilder, Record);
        }
    }
    return Gzip(ListBuilder.Build().Body);
}

function LockstepBufferFrames(Env = process.env) {
    const Frames = Number(Env.GRANITE_LOCKSTEP_BUFFER_FRAMES ?? 12);
    if (!Number.isInteger(Frames) || Frames < 1 || Frames > 49)
        throw new Error('GRANITE_LOCKSTEP_BUFFER_FRAMES must be 1..49');
    return Frames;
}

function BuildParameterBlob(Env = process.env) {
    const BufferFrames = LockstepBufferFrames(Env);
    const DelaySeconds = Math.fround(BufferFrames / 60);
    if (Math.ceil(Math.fround(DelaySeconds * 60)) !== BufferFrames)
        throw new Error('lockstep delay does not round-trip to the requested native frame count');
    return Gzip(
        new Builder()
            .AddF32(Crcs.LockstepDelaySeconds, DelaySeconds)
            .AddU64(0x35f052f5, 2n, Types.S64Observed)
            .AddBool(0x6157c6da, false)
            .AddU32(0x8ab4ed38, 0xef29f425)
            .AddU32(0x8ab4ed38, 0x69300cd5)
            .AddU32(0x8ab4ed38, 0x7dae7809)
            .AddU32(0x8ab4ed38, 0xef086c68)
            .AddF32(0xfd7c33fe, 0)
            .AddU64(0xfb8b8d55, 0x1an)
            .AddU64(0xe8c7331f, 0n, Types.S64Observed)
            .AddVCDate(0x5b618cd3, 0x0000c1435000cf80n)
            .AddVCDate(0x4fa04e98, 0x0000c1435000cf80n)
            .Build().Body,
    );
}

function Deny(Reason) {
    Logger.Error(`login denied: ${Reason}`);
    const Now = DateToVCDate();
    return new Builder()
        .AddVCDate(Crcs.ServerTime, Now)
        .AddVCDate(Crcs.IssuedAt, Now)
        .AddU32(Crcs.Result, Crcs.AccessDenied)
        .Build();
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const PlatformUserId = GetU64(Fields, Crcs.UserId);
    const Gamertag = GetString8(Fields, Crcs.GamertagLogin) || GetString8(Fields, Crcs.Gamertag) || '';

    const Identity =
        Context.Identity && typeof Context.Identity.Resolve === 'function'
            ? Context.Identity.Resolve(Input, Context)
            : null;
    if (Context.RequireVerifiedIdentity && !(Identity && Identity.verified)) {
        return Deny('no verified Celestial identity and RequireVerifiedIdentity is set');
    }

    const UserId = Identity && Identity.verified ? Identity.accountId : PlatformUserId;
    const Session = Context.Sessions.Create({
        userId: UserId,
        gamertag: Gamertag,
        verified: Boolean(Identity && Identity.verified),
        platformUserId: PlatformUserId,
        celestialUserId: Identity && Identity.verified ? Identity.celestialUserId : null,
    });
    if (Identity && Identity.verified) {
        Logger.Verbose(`login verified as Celestial user ${Identity.celestialUserId} -> account ${UserId}`);
    }
    const Endpoints = BuildEndpointBlob(Context.EndpointFile);
    const Now = DateToVCDate();
    const Reply = new Builder()
        .AddVCDate(Crcs.ServerTime, Now)
        .AddVCDate(Crcs.IssuedAt, Now)
        .AddU32(Crcs.Result, Crcs.Success)
        .AddU64(Crcs.SessionKey, Session.key)
        .AddU64(Crcs.ManifestTimestamp, 0n)
        .AddBinary(Crcs.Parameters, BuildParameterBlob())
        .AddBinary(Crcs.Services, Endpoints)
        .AddBinary(Crcs.Manifest, Gzip(Buffer.alloc(0)));
    const Environment = GetU32(Fields, Crcs.Environment);
    const Sku = GetU32(Fields, Crcs.SkuId);
    if (Environment !== null) Reply.AddU32(Crcs.Environment, Environment);
    else Logger.Error('login request did not carry ENVIRONMENT_NAME; Granite will not invent it');
    if (Sku !== null) {
        Reply.AddU32(Crcs.SkuId, Sku);
        if (Sku !== Exact2K19.SkuSelector) {
            Logger.Verbose(
                `login SKU selector 0x${Sku.toString(16).toUpperCase()} differs from NBA2K19 executable value 0x${Exact2K19.SkuSelector.toString(16).toUpperCase()}`,
            );
        }
    }
    Logger.Info(
        `issued session ${Session.key}; services blob ${Endpoints.length} bytes; lockstep lookahead ${LockstepBufferFrames()} frames at native 60 Hz`,
    );
    return Reply.Build();
}

module.exports = {
    Build,
    Login: Build,
    Crcs,
    Exact2K19,
    BuildEndpointBlob,
    BuildParameterBlob,
    LockstepBufferFrames,
    Status: 'REAL_2K19_LOGIN_FIELDS_PLUS_MIXED_EVIDENCE_SERVICE_TABLE',
};
