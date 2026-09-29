// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Describe, NoteFor } = require('./Names');

const Colour = {
    Info: '\x1b[38;2;162;213;210m',
    Verbose: '\x1b[38;2;181;126;220m',
    Error: '\x1b[38;2;229;57;53m',
    Reset: '\x1b[0m',
};

const Level = { Error: 0, Info: 1, Verbose: 2 };
let Threshold = Level.Info;

function SetLevel(LevelValue) {
    Threshold = LevelValue;
}

function Emit(Stream, ColourCode, Text) {
    Stream.write(ColourCode + String(Text) + Colour.Reset + '\n');
}

function Info(Text) {
    if (Threshold >= Level.Info) Emit(process.stdout, Colour.Info, Text);
}

function Verbose(Text) {
    if (Threshold >= Level.Verbose) Emit(process.stdout, Colour.Verbose, Text);
}

function LogError(Text) {
    if (Threshold >= Level.Error) Emit(process.stderr, Colour.Error, Text);
}

function Clock(When) {
    const D = When || new Date();
    const Pad = (N) => String(N).padStart(2, '0');
    return `${Pad(D.getHours())}:${Pad(D.getMinutes())}:${Pad(D.getSeconds())}`;
}

function PacketReceived(EngineFunction) {
    Info(`${EngineFunction} packet received by server.`);
}

function PlayerEntered(Identifier, Activity, When) {
    Info(`${Identifier} has entered ${String(Activity).toLowerCase()} @ ${Clock(When)}`);
}

function Constant(Value) {
    const Note = NoteFor(Value);
    const Name = Describe(Value);
    return Note ? `${Name} (${Note})` : Name;
}

module.exports = {
    Info,
    Verbose,
    Error: LogError,
    SetLevel,
    Level,
    Clock,
    PacketReceived,
    PlayerEntered,
    Constant,
    Colour,
};
