// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU32, GetU64 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const Logger = require('../../Core/Logger');

const Crcs = Object.freeze({
    Result: Crc32('RESULT'),
    SendContext: 0x0a94178e,
    Guid: 0x1dfa2206,
    PackageData: 0xe12d998f,
});

const Contexts = Object.freeze({
    RefreshSeason: 0x3cc59ab5,
});

const Success = Crc32('SUCCESS');
const NoPackage = 0xffffffffffffffffn;

function Build(Input) {
    const Fields = Input?.Parsed?.Fields || [];
    const Context = GetU32(Fields, Crcs.SendContext);
    if (Context === Contexts.RefreshSeason) {
        Logger.Verbose(
            `NBAToday/packagequery season refresh (client GUID ${GetU64(Fields, Crcs.Guid) ?? 'absent'}): ` +
                'no season package; answering GUID -1',
        );
        return new Builder().AddU32(Crcs.Result, Success).AddU64(Crcs.Guid, NoPackage).Build();
    }
    Logger.Verbose(
        `NBAToday/packagequery with unrecognised context ${Context === null ? 'absent' : `0x${Context.toString(16)}`}`,
    );
    return new Builder().AddU32(Crcs.Result, Success).Build();
}

module.exports = {
    Build,
    PackageQuery: Build,
    Crcs,
    Contexts,
    NoPackage,
    Status: 'IDA_TRACED_SEASON_REFRESH_NO_PACKAGE',
};
