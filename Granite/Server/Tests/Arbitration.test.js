// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { Parse, GetU32, Crc32 } = require('../Source/Codec/FieldList');
const Upload = require('../Source/Services/Arbitration/Upload');
const Registry = require('../Source/Services/Ida2K19/Registry');

const Park = Fs.readFileSync(Path.join(__dirname, 'Fixtures', 'Arbitration', 'AsyncArbitrationPark.bin'));
const Async = Fs.readFileSync(Path.join(__dirname, 'Fixtures', 'Arbitration', 'AsyncArbitration.bin'));
const Table = JSON.parse(Fs.readFileSync(Path.join(__dirname, '../Storage/Session/Login/Endpoints2K19.json'), 'utf8'));

Test('every arbitration service id the uploaders start has a SERVICES row that routes to the handler', () => {
    const Ids = [
        0xbe9c094d, 0x728258cd, 0x58bd1cb0, 0x6e101dab, 0x4433e4a1, 0x5c1d6652, 0xb62129c1, 0x906f6d8b, 0x373f9dbf,
    ];
    for (const Id of Ids) {
        const Hex = `0x${Id.toString(16).toUpperCase().padStart(8, '0')}`;
        const Row = Table.Endpoints.find((Endpoint) => Endpoint.EndpointId.toUpperCase() === Hex.toUpperCase());
        Assert.ok(Row, `${Hex} has a login SERVICES row`);
        const Parts = new URL(Row.Url).pathname.split('/').filter(Boolean);
        const Route = Parts.slice(-2).join('/').toLowerCase();
        Assert.equal(Upload.Resolve(Route), Id, `${Row.Url} reaches the arbitration handler`);
        Assert.equal(Registry.ByEndpointId.get(Id), Upload);
    }
});

Test('a park upload is answered SUCCESS and stored with player results named', () => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-arbitration-'));
    try {
        const Reply = Upload.Build(
            { Body: Park, Parsed: Parse(Park) },
            { Route: 'arbitrationv3/asyncarbitrationpark', userId: 76561198673346977n, ArbitrationDirectory: Root },
        );
        const Fields = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields;
        Assert.equal(Fields.length, 1);
        Assert.equal(GetU32(Fields, Crc32('RESULT')), Crc32('SUCCESS'));

        const Days = Fs.readdirSync(Root);
        Assert.equal(Days.length, 1);
        const Files = Fs.readdirSync(Path.join(Root, Days[0]));
        Assert.equal(Files.length, 1);
        const Record = JSON.parse(Fs.readFileSync(Path.join(Root, Days[0], Files[0]), 'utf8'));
        Assert.equal(Record.Service, 'ArbitrationV3/AsyncArbitrationPark');
        Assert.equal(Record.ServiceId, '0x728258CD');
        Assert.equal(Record.Summary.GameSessionId, '5704808029131446428');
        Assert.deepEqual(
            Record.Summary.Users.map((U) => [U.userId, U.W, U.L, U.Pts]),
            [
                ['76561198843023395', '0', '1', '0'],
                ['76561198428795625', '0', '1', '0'],
                ['76561198673346977', '1', '0', '0'],
                ['76561199618810214', '1', '0', '22'],
            ],
        );
        Assert.equal(Record.Fields.length, Parse(Park).Fields.length, 'every field is kept');
        Assert.ok(Record.Fields.some((F) => F.name === 'USER_PARK_COURT_NAME'));
    } finally {
        Fs.rmSync(Root, { recursive: true, force: true });
    }
});

Test('the AsyncArbitration upload resolves its names too', () => {
    const Fields = Parse(Async).Fields;
    const Described = Upload.Describe(Fields);
    const Named = new Set(Described.filter((F) => F.name).map((F) => F.Crc));
    const Distinct = new Set(Described.map((F) => F.Crc));
    Assert.ok(Named.size >= Distinct.size - 3, `${Named.size} of ${Distinct.size} distinct fields named`);
});
