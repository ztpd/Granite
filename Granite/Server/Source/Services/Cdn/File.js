// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Path = require('node:path');

const Pattern = /^[0-9A-Fa-f]{2}\/[0-9A-Fa-f]{2}\/[0-9A-Fa-f-]{16,64}$/;
const Neighborhood = /^neighborhood_[0-9A-Fa-f]{8}\.bin$/;

function Normalise(Url) {
    const Pathname = String(Url).split('?')[0];
    const Match = Pathname.match(/\/2k19\/(.+)$/i);
    if (!Match) return null;
    const Relative = Match[1].replace(/^\/+/, '');
    return Pattern.test(Relative) || Neighborhood.test(Relative) ? Relative : null;
}

function Read(Url, Root) {
    const Relative = Normalise(Url);
    if (!Relative) return null;
    const Base = Path.resolve(Root);
    const File = Path.resolve(Base, Relative);
    if (!File.startsWith(`${Base}${Path.sep}`) || !Fs.existsSync(File) || !Fs.statSync(File).isFile()) return null;
    return Fs.readFileSync(File);
}

module.exports = { Normalise, Read, Status: 'REAL_LOCAL_CDN_ONLY' };
