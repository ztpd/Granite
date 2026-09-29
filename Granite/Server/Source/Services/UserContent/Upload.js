// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('node:crypto');
const Fs = require('node:fs');
const Path = require('node:path');
const Logger = require('../../Core/Logger');
const { Builder, GetU32, GetU64, GetString8 } = require('../../Codec/FieldList');
const C = require('./Fields');

const BundleMagic = Buffer.from('BNH"', 'ascii');
const EndpointIds = Object.freeze([0x8290b650]);

function OwnerName(Fields, Context) {
    return (GetString8(Fields, C.Gamertag) || Context.gamertag || 'Unknown').trim() || 'Unknown';
}

function UploadName(Fields) {
    return (
        GetString8(Fields, C.FileName) ||
        GetString8(Fields, C.Description) ||
        GetString8(Fields, C.FilePath) ||
        'USERDATA'
    );
}

function ExactUserDataBundle(Payload) {
    const At = Payload.indexOf(BundleMagic);
    if (At < 0 || At + 8 > Payload.length) return null;
    const Length = 8 + Payload.readUInt32LE(At + 4);
    if (Length <= 8 || At + Length > Payload.length) return null;
    return Payload.subarray(At, At + Length);
}

function IsGraphicsUpload(FileName, Description) {
    return `${FileName} ${Description}`.toLowerCase().includes('textures and vertex data for myplayer graphics');
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const RequestUserId = GetU64(Fields, C.UserId);
    const AccountId = Context.userId ?? (RequestUserId !== null && RequestUserId !== 0n ? RequestUserId : 0n);
    const Owner = OwnerName(Fields, Context);
    const FileType = GetU32(Fields, C.FileType) || C.UserData;
    const FileName = UploadName(Fields);
    const Description = GetString8(Fields, C.Description) || FileName;
    const Declared64 = GetU64(Fields, C.ExtraDataSize) ?? 0n;
    const Declared = Declared64 <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(Declared64) : -1;
    if (Declared <= 0 || Declared > Input.Body.length) {
        Logger.Error(`upload not stored: owner=${Owner} payload=${Declared}`);
        return new Builder().AddU32(C.Result, C.Success).Build();
    }
    const Start = Input.Body.length - Declared;
    if (Input.Parsed && Start < Input.Parsed.DataOffset) {
        Logger.Error(`upload declares ${Declared} bytes but is truncated`);
        return new Builder().AddU32(C.Result, C.Success).Build();
    }
    let Payload = Input.Body.subarray(Start);
    const IsUserData = FileType === C.UserData || FileName.toUpperCase() === 'USERDATA';
    if (IsUserData) {
        const Bundle = ExactUserDataBundle(Payload);
        if (!Bundle) {
            Logger.Error(`USERDATA upload for ${Owner} has no complete NBA2K19 BNH\" bundle; not storing corrupt data`);
            return new Builder().AddU32(C.Result, C.Success).Build();
        }
        Payload = Bundle;
    }
    if (AccountId === 0n) {
        Logger.Error(`upload not stored: ${Owner} has no authenticated account id`);
        return new Builder().AddU32(C.Result, C.Success).Build();
    }
    const Entry = Context.content.Save({
        accountId: AccountId,
        ownerName: Owner,
        fileType: FileType,
        fileName: FileName,
        description: Description,
        Payload,
    });
    Logger.Info(
        `stored ${FileName} for ${Owner} (${Entry.accountId}), ${Payload.length} bytes, file id ${Entry.fileId.toString(16).toUpperCase()}`,
    );

    if (IsGraphicsUpload(FileName, Description)) {
        const Name = `neighborhood_${Crypto.createHash('sha256').update(Payload).digest('hex').slice(0, 8)}.bin`;
        if (Context.CdnDirectory) {
            Fs.mkdirSync(Context.CdnDirectory, { recursive: true });
            Fs.writeFileSync(Path.join(Context.CdnDirectory, Name), Payload);
        } else {
            Logger.Error(`no CDN directory; ${Name} for ${Owner} cannot be served to peers`);
        }
        Logger.Info(`neighborhood graphics for ${Owner} published as ${Name}`);
        return new Builder().AddU32(C.Result, C.Success).AddString8(C.FilePath, Name).Build();
    }
    if (!IsUserData) {
        const ContentPath = `${FileName}_${Crypto.createHash('sha256').update(Payload).digest('hex').slice(0, 16)}.iff`;
        Logger.Info(`texture ${FileName} for ${Owner} published as CONTENT:${ContentPath}`);
        return new Builder().AddString8(C.FilePath, ContentPath).AddU32(C.Result, C.Success).Build();
    }
    return new Builder().AddU32(C.Result, C.Success).Build();
}

module.exports = {
    Build,
    Upload: Build,
    BundleMagic,
    EndpointIds,
    ExactUserDataBundle,
    IsGraphicsUpload,
    Status: 'REAL_2K19_IDA_ID_PLUS_CAPTURED_WIRE_AND_ACCOUNT_OWNERSHIP',
};
