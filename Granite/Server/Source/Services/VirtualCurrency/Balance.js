// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const Balance = 0x93b1e1e4;
const StartingBalance = 100000n;
function ParseBoolean(Value, Fallback) {
    if (Value === undefined || Value === null || Value === '') return Fallback;
    return !['0', 'false', 'no', 'off'].includes(String(Value).trim().toLowerCase());
}

const StaticBalance = ParseBoolean(process.env.GRANITE_VC_STATIC, false);

function IsStaticBalance(Context = {}) {
    if (typeof Context.VirtualCurrencyStatic === 'boolean') return Context.VirtualCurrencyStatic;
    if (typeof Context.VcStatic === 'boolean') return Context.VcStatic;
    return StaticBalance;
}

function BalanceFor(Context = {}) {
    const Key = Context.userId === null || Context.userId === undefined ? 'anonymous' : Context.userId.toString();
    if (!Context.Wallets) return StartingBalance;
    if (IsStaticBalance(Context)) {
        Context.Wallets.set(Key, StartingBalance);
        return StartingBalance;
    }
    if (!Context.Wallets.has(Key)) Context.Wallets.set(Key, StartingBalance);
    return Context.Wallets.get(Key);
}

function Build(Input, Context = {}) {
    return new Builder().AddU32(Crc32('RESULT'), Crc32('SUCCESS')).AddU64(Balance, BalanceFor(Context)).Build();
}

module.exports = {
    Build,
    Balance: Build,
    BalanceFor,
    StartingBalance,
    StaticBalance,
    IsStaticBalance,
    Status: 'CONFIRMED_2K19_BALANCE_FIELD_DEBIT_BY_DEFAULT',
};
