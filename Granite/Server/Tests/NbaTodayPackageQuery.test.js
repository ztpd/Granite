// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Https = require('node:https');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Types, Parse, GetField, GetFields, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const PackageQuery = require('../Source/Services/NBAToday/PackageQuery');
const { CreateGraniteServer } = require('../Source/Server');

const { Crcs, Contexts, NoPackage } = PackageQuery;
const Success = 0x504521a8;

const CapturedRequest = Buffer.from(
    '0a94178e1423add23cc59ab5f47f00001dfa22063d9e5089000000000000000000000000000000000000000000000000',
    'hex',
);

function SeasonReceiveBranch(Reply, InstalledId, RosterId) {
    const { Fields } = Parse(Reply);
    if (GetU32(Fields, Crcs.Result) !== Success) return 'error-communicating';
    const Guid = GetU64(Fields, Crcs.Guid) ?? 0n;
    if (Guid === 0n) return 'invalid-package-id';
    if (Guid === InstalledId) {
        return RosterId === Guid ? 'bail' : 'season-roster-disagree';
    }
    const Data = GetField(Fields, Crcs.PackageData, 0, Types.Binary);
    if (!Data) return 'no-package';
    return 'process-package';
}

Test('the captured Team Control request gets the no-package answer, not a bare SUCCESS', () => {
    const Req = Parse(CapturedRequest).Fields;
    Assert.equal(GetU32(Req, Crcs.SendContext), Contexts.RefreshSeason);
    Assert.equal(GetU64(Req, Crcs.Guid), 0n);
    const Reply = PackageQuery.Build({ Parsed: Parse(CapturedRequest) });
    const { Fields } = Parse(Reply.Body);
    Assert.equal(Fields.length, 2);
    Assert.equal(GetU32(Fields, Crcs.Result), Success);
    const Guid = GetFields(Fields, Crcs.Guid);
    Assert.equal(Guid.length, 1);
    Assert.equal(Guid[0].Type, Types.U64, 'read with GetU64 (sub_1418ED490)');
    Assert.equal(Guid[0].value, NoPackage);
    Assert.equal(GetFields(Fields, Crcs.PackageData).length, 0, 'no season package is fabricated');
});

Test('every installed-package state takes a quiet branch; the old bare reply took the fatal one', () => {
    const Fixed = PackageQuery.Build({ Parsed: Parse(CapturedRequest) }).Body;
    const Bare = new Builder().AddU32(Crcs.Result, Success).Build().Body;
    const States = [
        { Installed: 0xffffffffffffffffn, Roster: 0xffffffffffffffffn, Expect: 'bail' },
        { Installed: 0n, Roster: 0n, Expect: 'no-package' },
        { Installed: 0x1234abcdn, Roster: 0x1234abcdn, Expect: 'no-package' },
    ];
    for (const State of States) {
        Assert.equal(SeasonReceiveBranch(Fixed, State.Installed, State.Roster), State.Expect);
        Assert.equal(
            SeasonReceiveBranch(Bare, State.Installed, State.Roster),
            'invalid-package-id',
            'the reply Granite used to send hits "Invalid package id returned, killing service"',
        );
    }
});

Test('HTTPS serves the real /NBAToday/packagequery URL through the new handler', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-packagequery-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Instance = CreateGraniteServer({
        Host: '127.0.0.1',
        Port: 0,
        PublicHost: '127.0.0.1',
        WorldPort: 20054,
        RelayPort: 28091,
        RelaySessionPort: 0x2628,
        CertificateDirectory: Path.join(Root, 'certificate'),
        CaptureDirectory: Path.join(Root, 'captures'),
        UserContentDirectory: Path.join(Root, 'content'),
        SessionDirectory: Path.join(Root, 'sessions'),
        CdnDirectory: Path.join(Root, 'cdn'),
        EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
        MaximumBodyBytes: 1024 * 1024,
    });
    await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
    const Port = Instance.Server.address().port;
    const Body = await new Promise((Resolve, Reject) => {
        const Req = Https.request(
            {
                host: '127.0.0.1',
                port: Port,
                path: '/nba/2k19/NBAToday/packagequery?x=3906216560843609741',
                method: 'POST',
                rejectUnauthorized: false,
                headers: {
                    'Content-Length': String(CapturedRequest.length),
                    VCFIELDLIST_SIZE: String(CapturedRequest.length),
                },
            },
            (Incoming) => {
                const Chunks = [];
                Incoming.on('data', (Chunk) => Chunks.push(Chunk));
                Incoming.on('end', () => Resolve(Buffer.concat(Chunks)));
            },
        );
        Req.on('error', Reject);
        Req.end(CapturedRequest);
    });
    const { Fields } = Parse(Body);
    Assert.equal(GetU32(Fields, Crcs.Result), Success);
    Assert.equal(GetU64(Fields, Crcs.Guid), NoPackage);
});
