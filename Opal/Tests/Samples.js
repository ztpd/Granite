// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

function Rows(...RowList) {
    RowList.forEach((R, I) => {
        if (R.replace(/\s/g, '').length !== 32) throw new Error(`sample row ${I} is not 16 bytes`);
    });
    return Buffer.from(RowList.join('').replace(/\s/g, ''), 'hex');
}

const Movement = Buffer.from('1e000000ce1c9e8cfa68000000000000ff4d000049a083fc9797cf000010', 'hex');

const Connect = Rows(
    '80 03 00 00 9d 32 c5 b4 00 00 00 00 00 00 00 00',
    '17 80 ec 1f 3d 9e 50 89 00 00 00 00 00 00 00 00',
    '1d ee 49 9c 14 23 ad d2 92 e5 6e 10 00 00 00 00',
    '27 ef d4 60 3d 9e 50 89 01 10 00 01 03 b5 7f 79',
    '2e 64 60 54 3d 9e 50 89 00 00 00 00 00 00 00 00',
    '2e 6b c5 cc 63 14 db 26 00 00 00 01 00 00 00 00',
    '3a 60 fe 52 3d 9e 50 89 01 10 00 01 03 b5 7f 79',
    '4b 7a d8 c3 14 23 ad d2 00 00 00 00 00 00 00 00',
    '51 df 9d 5a 3d 9e 50 89 00 00 00 00 00 00 00 00',
    '53 d8 41 8b 3d 9e 50 89 00 00 00 00 00 00 00 1e',
    '58 4b 0f 04 3d 9e 50 89 00 00 00 00 00 00 00 00',
    '5b b7 8c 48 14 23 ad d2 64 b5 98 e0 00 00 00 00',
    '5c ed b5 80 14 23 ad d2 cd 23 d3 f3 00 00 00 00',
    '5f 49 68 77 3d 9e 50 89 00 00 00 00 00 00 00 4b',
    '62 d1 07 24 6e 46 75 2f 00 00 00 00 00 00 00 17',
    '64 bb 87 16 6e 46 75 2f 00 00 00 18 00 00 00 01',
    '69 35 78 b9 3d 9e 50 89 00 00 00 00 00 00 00 5f',
    '7e 49 64 27 14 23 ad d2 49 05 ed 7b 00 00 00 00',
    '80 1f 78 b9 3d 9e 50 89 00 00 00 00 00 00 00 00',
    '8f 63 9d 27 3d 9e 50 89 00 00 00 00 00 00 00 77',
    '98 44 a7 c6 14 23 ad d2 cd 23 d3 f3 00 00 00 00',
    '98 ad 15 87 14 23 ad d2 19 b6 39 86 00 00 00 00',
    '9a d3 e8 f7 36 18 2e 83 00 00 00 20 00 00 00 00',
    'ab 31 ac 76 6e 46 75 2f 00 00 00 20 00 00 00 01',
    'cc a1 18 38 14 23 ad d2 00 00 00 00 00 00 00 00',
    'd6 15 f1 d1 3d 9e 50 89 00 00 00 00 66 d0 27 ea',
    'e3 01 c3 ff 36 18 2e 83 00 00 00 28 00 00 01 80',
    'ff 61 4c 87 6e 46 75 2f 00 00 01 a8 00 00 00 06',
    '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00',
    '77 73 73 3a 2f 2f 31 32 37 2e 30 2e 30 2e 31 3a',
    '32 30 30 35 34 2f 00 00 00 00 00 00 00 00 00 00',
);

const Compressed = Rows(
    'c4 0a 00 00 9e 34 71 ed fa 68 00 00 00 00 00 00',
    '00 00 00 00 00 00 00 00 00 00 0a a8 97 0e 50 df',
    '36 18 2e 83 00 00 00 00 00 00 0a 73 b1 8f 14 ce',
    '14 23 ad d2 cd bd 17 5e 00 00 0a 65 00 00 00 00',
    '00 00 00 00 00 00 00 00 00 00 00 00 78 da ed dd',
);

const TrueLength = { Connect: 896, Compressed: 2756, Movement: 30 };

function AsStandalone(Bytes) {
    const Copy = Buffer.from(Bytes);
    Copy.writeUInt32LE(Copy.length, 0);
    return Copy;
}

module.exports = { Rows, Movement, Connect, Compressed, TrueLength, AsStandalone };
