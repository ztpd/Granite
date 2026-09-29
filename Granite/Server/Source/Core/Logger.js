// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Colour = Object.freeze({
    Green: '\x1b[92m',
    Yellow: '\x1b[93m',
    Red: '\x1b[91m',
    Dim: '\x1b[2m',
    Reset: '\x1b[0m',
});

function Stamp() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function Line(Stream, ColourCode, Glyph, Message) {
    const Prefix = `${Glyph} ${Stamp()} `;
    if (Stream.isTTY) Stream.write(`${ColourCode}${Prefix}${Message}${Colour.Reset}\n`);
    else Stream.write(`${Prefix}${Message}\n`);
}

function Info(Message) {
    Line(process.stdout, Colour.Green, '@', String(Message));
}

function Verbose(Message) {
    Line(process.stdout, Colour.Yellow, '~', String(Message));
}

function LogError(Message, Cause) {
    const Suffix = Cause ? `: ${Cause.stack || Cause.message || Cause}` : '';
    Line(process.stderr, Colour.Red, '!', `${Message}${Suffix}`);
}

function Detail(Message) {
    const Text = `  ${String(Message)}\n`;
    process.stdout.write(process.stdout.isTTY ? `${Colour.Dim}${Text}${Colour.Reset}` : Text);
}

module.exports = { Info, Verbose, Error: LogError, Detail };
