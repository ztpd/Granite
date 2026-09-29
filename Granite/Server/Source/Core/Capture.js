// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const { TryParse, Serializable } = require('../Codec/FieldList');

let Sequence = 0;

function Safe(Text) {
    return (
        String(Text || 'root')
            .replace(/[^a-z0-9.-]+/gi, '_')
            .slice(0, 100) || 'root'
    );
}

function Save(Directory, Req, Body) {
    Fs.mkdirSync(Directory, { recursive: true });
    const Now = new Date();
    const Stamp = Now.toISOString().replace(/[-:.TZ]/g, '');
    const Id = `${Stamp}_${process.pid}_${String(++Sequence).padStart(6, '0')}_${Safe(Req.method)}_${Safe(Req.url)}`;
    const Base = Path.join(Directory, Id);
    const Raw = Buffer.isBuffer(Body) ? Body : Buffer.alloc(0);
    const Declared = Number(Req.headers?.vcfieldlist_size || Req.headers?.['vcfieldlist-size'] || 0);
    const Parsed = Raw.length ? TryParse(Raw, { FieldListSize: Declared || undefined }) : null;
    const Sidecar = {
        CapturedAt: Now.toISOString(),
        method: Req.method || '',
        url: Req.url || '',
        RequestId: Req.headers?.['vc-request-id'] || '',
        remoteAddress: Req.socket?.remoteAddress || '',
        headers: Req.headers || {},
        BodyBytes: Raw.length,
        DeclaredFieldListBytes: Declared || null,
        Parse: !Parsed
            ? { Status: 'empty' }
            : Parsed.Ok
              ? { Status: 'ok', value: Serializable(Parsed.Parsed) }
              : { Status: 'error', message: Parsed.Error.message },
    };
    Fs.writeFileSync(`${Base}.bin`, Raw);
    Fs.writeFileSync(`${Base}.json`, `${JSON.stringify(Sidecar, null, 2)}\n`, 'utf8');
    return Base;
}

function SaveResponse(Base, Req, Res) {
    const Body = Buffer.isBuffer(Res?.Body) ? Res.Body : Buffer.alloc(0);
    const Declared = Number(Res?.FieldListSize || Body.length || 0);
    const Parsed = Body.length ? TryParse(Body, { FieldListSize: Declared || undefined }) : null;
    const Sidecar = {
        CapturedAt: new Date().toISOString(),
        RequestId: Req?.headers?.['vc-request-id'] || '',
        BodyBytes: Body.length,
        DeclaredFieldListBytes: Declared || null,
        Parse: !Parsed
            ? { Status: 'empty' }
            : Parsed.Ok
              ? { Status: 'ok', value: Serializable(Parsed.Parsed) }
              : { Status: 'error', message: Parsed.Error.message },
    };
    Fs.writeFileSync(`${Base}.response.bin`, Body);
    Fs.writeFileSync(`${Base}.response.json`, `${JSON.stringify(Sidecar, null, 2)}\n`, 'utf8');
}

module.exports = { Save, SaveResponse };
