// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const Connection = require('../Source/Protocol/Connection');
const Userdata = require('../Source/Protocol/Userdata');

let Passed = 0;
function Test(Name, Fn) {
    try {
        Fn();
        Passed++;
        process.stdout.write(`\x1b[38;5;39m  pass  ${Name}\x1b[0m\n`);
    } catch (E) {
        process.stdout.write(`\x1b[38;5;203m  FAIL  ${Name}\n        ${E.message}\x1b[0m\n`);
        process.exitCode = 1;
    }
}

function BuildCompressed(Command) {
    const Body = new FieldList.Builder().AddBlob('COMPRESSED_DATA', Buffer.alloc(0)).AddU32('COMMAND', Command).Build();
    return Frame.Build(0x9e3471ed, Buffer.alloc(8), Body, Frame.InnerHeader.Object);
}

Test('sendcommand and compressed commands are always traced', () => {
    Assert.ok(Connection.TracedFieldPackets.has(0xce148fb1), 'sendcommand');
    Assert.ok(Connection.TracedFieldPackets.has(0x9e3471ed), 'compressed (0xED in-code)');
});

Test('high-rate packets stay first-sighting-only', () => {
    Assert.ok(!Connection.TracedFieldPackets.has(0xce1c9e8c), 'movement');
    Assert.ok(!Connection.TracedFieldPackets.has(0x9d32c5b4), 'connect');
});

Test('non-userdata compressed commands are tallied, not relayed', () => {
    const Client = { Id: 77, Identifier: 'capture-test', Activity: 'mycourt' };
    const Sent = Userdata.Relay(Client, BuildCompressed(0xab153d7e));
    Assert.strictEqual(Sent, 0);
    Assert.strictEqual(Client.CompressedCommands.get(0xab153d7e), 1);
    Userdata.Relay(Client, BuildCompressed(0xab153d7e));
    Assert.strictEqual(Client.CompressedCommands.get(0xab153d7e), 2);
});

Test('userdata commands are tallied on the same map', () => {
    const Client = { Id: 78, Identifier: 'capture-test-2', Activity: 'mycourt' };
    Userdata.Relay(Client, BuildCompressed(Userdata.UserdataCommand));
    Assert.strictEqual(Client.CompressedCommands.get(Userdata.UserdataCommand >>> 0), 1);
});

process.stdout.write(`\n${Passed} passing\n`);
