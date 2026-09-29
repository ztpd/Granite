// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU64 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

function PackIpv4(Ip) {
    const Octets = String(Ip).split('.').map(Number);
    if (Octets.length !== 4 || Octets.some((Value) => !Number.isInteger(Value) || Value < 0 || Value > 255)) return 0;
    return ((Octets[0] << 24) | (Octets[1] << 16) | (Octets[2] << 8) | Octets[3]) >>> 0;
}

function Build(Input, Context = {}) {
    const Host = '127.0.0.1';
    const Port = Number(Context.WorldPort || 20054);
    const Url = `wss://${Host}:${Port}`;
    const Account = GetU64(Input?.Parsed?.Fields || [], 0x693578b9) ?? Context.userId ?? 0n;
    return new Builder()
        .AddString8(0x62d10724, Url)
        .AddPacked(0x6cd5d4f9, PackIpv4(Host), (Port << 16) >>> 0)
        .AddU64(0x693578b9, Account)
        .AddU32(Crc32('RESULT'), Crc32('SUCCESS'))
        .Build();
}

module.exports = { Build, Connect: Build, PackIpv4, Status: 'SAPPHIRE_COMPATIBILITY_UNVERIFIED_FOR_2K19' };
