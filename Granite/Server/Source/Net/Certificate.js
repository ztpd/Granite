// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('node:crypto');
const Fs = require('node:fs');
const Path = require('node:path');
const { execFileSync: ExecFileSync } = require('node:child_process');

function Candidates() {
    return [
        process.env.OPENSSL_PATH,
        'openssl',
        'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    ].filter(Boolean);
}

function Generate(Directory, Logger) {
    const Root = Path.resolve(Directory);
    const Crt = Path.join(Root, 'Granite.crt');
    const Key = Path.join(Root, 'Granite.key');
    if (Fs.existsSync(Crt) && Fs.existsSync(Key)) return { Crt, key: Key, Generated: false };
    Fs.mkdirSync(Root, { recursive: true });
    const Suffix = Crypto.randomBytes(8).toString('hex');
    const Serial = `0x${Crypto.randomBytes(16).toString('hex')}`;
    let Last;
    for (const Executable of Candidates()) {
        try {
            ExecFileSync(
                Executable,
                [
                    'req',
                    '-x509',
                    '-newkey',
                    'rsa:2048',
                    '-sha256',
                    '-nodes',
                    '-keyout',
                    Key,
                    '-out',
                    Crt,
                    '-days',
                    '3650',
                    '-set_serial',
                    Serial,
                    '-subj',
                    `/CN=granite-${Suffix}`,
                    '-addext',
                    'subjectAltName=IP:127.0.0.1,DNS:localhost',
                ],
                { stdio: 'ignore' },
            );
            Logger?.Info(`generated random self-signed certificate in ${Root}`);
            return { Crt, key: Key, Generated: true };
        } catch (Failure) {
            Last = Failure;
        }
    }
    throw new Error(
        `could not generate ${Crt} and ${Key}; set OPENSSL_PATH or install OpenSSL (${Last?.message || 'not found'})`,
    );
}

module.exports = { Generate };
