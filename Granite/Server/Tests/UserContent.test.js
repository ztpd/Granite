// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Parse, GetU32, GetU64, GetString8 } = require('../Source/Codec/FieldList');
const { ContentStore } = require('../Source/Storage/ContentStore');
const { SessionStore } = require('../Source/Storage/SessionStore');
const C = require('../Source/Services/UserContent/Fields');
const Upload = require('../Source/Services/UserContent/Upload');
const List = require('../Source/Services/UserContent/List');
const Download = require('../Source/Services/UserContent/Download');

Test('USERDATA upload-list-download round trip is byte exact', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-userdata-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Content = new ContentStore(Root);
    const UserId = 0x0110000100000666n;
    const Payload = Buffer.alloc(72, 0xa5);
    Payload.write('BNH"', 0, 'ascii');
    Payload.writeUInt32LE(Payload.length - 8, 4);
    const UploadWire = new Builder()
        .AddU64(C.UserId, UserId)
        .AddU32(C.FileType, C.UserData)
        .AddString8(C.FileName, 'USERDATA')
        .AddString8(C.Description, 'USERDATA')
        .AddString8(C.Gamertag, 'GRANITE')
        .AddU64(C.ExtraDataSize, BigInt(Payload.length))
        .AlignData(8)
        .Build({ Trailing: Payload });
    const UploadInput = {
        Body: UploadWire.Body,
        Parsed: Parse(UploadWire.Body, { FieldListSize: UploadWire.FieldListSize }),
    };
    const Context = { userId: UserId, gamertag: 'GRANITE', content: Content };
    const UploadReply = Upload.Build(UploadInput, Context);
    Assert.deepEqual(Payload.subarray(0, 4), Upload.BundleMagic);
    Assert.equal(GetU32(Parse(UploadReply.Body).Fields, C.Result), C.Success);

    const ListWire = new Builder().AddU32(C.FileType, C.UserData).AddU64(C.MaxResults, 1n).Build();
    const ListReply = List.Build({ Body: ListWire.Body, Parsed: Parse(ListWire.Body) }, Context);
    const Listed = Parse(ListReply.Body);
    Assert.equal(GetU64(Listed.Fields, C.CountObserved), 1n);
    const FileId = GetU64(Listed.Fields, C.FileId);
    Assert.ok(FileId && FileId !== 0n);
    Assert.ok(
        Listed.Fields.some((Field) => Field.Crc === C.FileId),
        'the 2K19 FILEID field 0xCAB9AB81 is preserved in the list entry',
    );
    Assert.equal(GetU64(Listed.Fields, C.DataSize), BigInt(Payload.length));

    const Req = new Builder().AddU64(C.FileId, FileId).Build();
    const Res = Download.Build({ Body: Req.Body, Parsed: Parse(Req.Body) }, Context);
    const Downloaded = Parse(Res.Body, { FieldListSize: Res.FieldListSize });
    Assert.equal(GetU64(Downloaded.Fields, C.UserId), UserId, '2K checks USERID before reading payload');
    Assert.equal(GetU64(Downloaded.Fields, C.ExtraDataSize), BigInt(Payload.length));
    Assert.deepEqual(Downloaded.Trailing, Payload);
    Assert.equal(
        (Res.FieldListSize - Downloaded.TableBytes) % 8,
        0,
        'payload starts 8-byte aligned after variable data',
    );
});

Test('account-neutral neighborhood graphics are owned by the authenticated account id', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-graphics-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Content = new ContentStore(Path.join(Root, 'content'));
    const Sessions = new SessionStore(Path.join(Root, 'sessions'));
    const UserId = 0x0110000100000666n;
    const Session = Sessions.Create({ userId: UserId, gamertag: 'SteamRIP' });

    Sessions.bind(Session.key, { userId: 0n });
    Assert.equal(
        Sessions.get(Session.key).userId,
        UserId,
        'zero request metadata must not replace the authenticated account',
    );

    const Payload = Buffer.from('504b03040a0000000000', 'hex');
    const UploadWire = new Builder()
        .AddU64(C.UserId, 0n)
        .AddU32(C.FileType, 0x4b4fb1ae)
        .AddString8(C.Description, 'Textures and vertex data for MyPLAYER graphics')
        .AddString8(C.FilePath, 'MyPLAYER_Neighborhood_Graphics')
        .AddU64(C.ExtraDataSize, BigInt(Payload.length))
        .AlignData(8)
        .Build({ Trailing: Payload });
    const Input = {
        Body: UploadWire.Body,
        Parsed: Parse(UploadWire.Body, { FieldListSize: UploadWire.FieldListSize }),
    };
    const CdnDirectory = Path.join(Root, 'cdn');
    const Res = Upload.Build(Input, { userId: UserId, gamertag: 'SteamRIP', content: Content, CdnDirectory });
    const Reply = Parse(Res.Body);
    Assert.equal(GetU32(Reply.Fields, C.Result), C.Success);
    const Published = GetString8(Reply.Fields, C.FilePath);
    Assert.match(Published, /^neighborhood_[0-9a-f]{8}\.bin$/);
    Assert.deepEqual(
        Fs.readFileSync(Path.join(CdnDirectory, Published)),
        Payload,
        'peers GET the published name from the CDN directory',
    );

    const Entries = Content.List(UserId, 0x4b4fb1ae);
    Assert.equal(Entries.length, 1);
    Assert.equal(Entries[0].ownerName, 'SteamRIP');
    Assert.equal(Entries[0].userId, '0110000100000666');
    Assert.equal(Entries[0].fileName, 'Textures and vertex data for MyPLAYER graphics');
    Assert.match(Entries[0].relativePath, /^0110000100000666\//);
    Assert.equal(Content.List(0n, 0x4b4fb1ae).length, 0, 'nothing is filed under the request body USERID');
});

function TattooTextureCallback(Reply) {
    const { Fields } = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    if (GetU32(Fields, C.Result) !== C.Success) return null;
    const PathValue = GetString8(Fields, 0xaf4f8020);
    return PathValue ? `CONTENT:${PathValue}` : '';
}

Test('captured tattoo texture uploads get a FILEPATH, so each tattoo slot names a texture', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-tattoo-texture-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Content = new ContentStore(Root);
    const UserId = 0x01100001349dd023n;
    const Names = new Set();
    for (const [Capture, Part] of [
        ['37', 'Face'],
        ['40', 'Chest'],
        ['41', 'Torso'],
    ]) {
        const Body = Fs.readFileSync(Path.join(__dirname, 'Fixtures', 'TattooTextureUploads', `Upload${Capture}.bin`));
        const Parsed = Parse(Body, { FieldListSize: 264 });
        Assert.equal(GetString8(Parsed.Fields, C.FilePath), `Small_${Part}_Tattoo`);
        Assert.equal(GetString8(Parsed.Fields, C.FileName), null, 'the texture upload has no FILENAME');

        const Bare = TattooTextureCallback(
            new Builder().AddString8(C.FileName, `Small_${Part}_Tattoo`).AddU32(C.Result, C.Success).Build(),
        );
        Assert.equal(Bare, '', 'the previous FILENAME-only reply left the slot empty');

        const Reply = Upload.Build({ Body, Parsed }, { userId: UserId, gamertag: 'frag', content: Content });
        const Slot = TattooTextureCallback(Reply);
        Assert.match(Slot, new RegExp(`^CONTENT:Small_${Part}_Tattoo_[0-9a-f]{16}\.iff$`));
        Assert.ok(Slot.length < 256, 'fits the 256-byte appearance tattoo slot');
        Names.add(Slot);
    }
    Assert.equal(Names.size, 3, 'each tattoo image gets its own CONTENT name');
    const Stored = [0x4432bd4f, 0x7da2dcd5, 0xb5cbf168].map((Type) => Content.List(UserId, Type).length);
    Assert.deepEqual(Stored, [1, 1, 1], 'each body part texture is stored for the account under its own FILETYPE');
});

Test('UserContent follows an account across display-name changes and isolates matching names', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-account-content-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Content = new ContentStore(Root);
    const First = 0x0110000100000666n;
    const Second = 0x0110000100000777n;
    const Type = C.UserData;
    const Payload = Buffer.from('BNH\"\u0004\u0000\u0000\u0000DATA', 'binary');

    const Original = Content.Save({
        accountId: First,
        ownerName: 'OldName',
        fileType: Type,
        fileName: 'USERDATA',
        Payload,
    });
    Assert.equal(Content.List(First, Type).length, 1);

    const Renamed = Content.Save({
        accountId: First,
        ownerName: 'NewName',
        fileType: Type,
        fileName: 'USERDATA',
        Payload,
    });
    Assert.equal(Renamed.fileId, Original.fileId, 'a display-name change must not create a new identity');
    Assert.equal(Content.List(First, Type)[0].ownerName, 'NewName');

    const Other = Content.Save({
        accountId: Second,
        ownerName: 'NewName',
        fileType: Type,
        fileName: 'USERDATA',
        Payload,
    });
    Assert.notEqual(Other.fileId, Original.fileId, 'matching display names must not merge accounts');
    Assert.equal(Content.List(First, Type).length, 1);
    Assert.equal(Content.List(Second, Type).length, 1);
    Assert.equal(Content.FindById(Other.fileId, First), null, 'downloads remain scoped to the account');
});

Test('missing USERDATA payloads are not enumerated or reported as successful downloads', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-stale-userdata-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Content = new ContentStore(Root);
    const UserId = 0x01100001349dd023n;
    const Payload = Buffer.from('BNH"\u0004\u0000\u0000\u0000DATA', 'binary');
    const Saved = Content.Save({
        accountId: UserId,
        ownerName: 'frag',
        fileType: C.UserData,
        fileName: 'USERDATA',
        description: 'USERDATA',
        Payload,
    });
    Fs.rmSync(Path.join(Root, Saved.relativePath));

    Assert.equal(
        Content.List(UserId, C.UserData).length,
        0,
        'enumeration must not advertise a file the client cannot download',
    );

    const Req = new Builder().AddU64(C.FileId, Saved.fileId).Build();
    const Res = Download.Build(
        { Body: Req.Body, Parsed: Parse(Req.Body) },
        { userId: UserId, gamertag: 'frag', content: Content },
    );
    const Decoded = Parse(Res.Body, { FieldListSize: Res.FieldListSize });
    Assert.equal(GetU32(Decoded.Fields, C.Result), Download.NotFound);
    Assert.equal(GetU64(Decoded.Fields, C.DataSize), 0n);
});
