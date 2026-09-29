// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc32 } = require('../../Core/Crc32');

module.exports = Object.freeze({
    UserId: Crc32('USERID'),
    FileType: Crc32('FILETYPE'),
    FileName: Crc32('FILENAME'),
    FilePath: Crc32('FILEPATH'),
    FileId: Crc32('FILEID'),
    Description: Crc32('DESCRIPTION'),
    Gamertag: Crc32('GAMERTAG'),
    DataSize: Crc32('DATASIZE'),
    ExtraDataSize: Crc32('EXTRA_DATA_SIZE'),
    MaxResults: Crc32('MAXRESULTS'),
    Rating: Crc32('RATING'),
    NumDownloads: Crc32('NUMDOWNLOADS'),
    TitleId: Crc32('TITLEID'),
    MoreAvailable: Crc32('MOREAVAILABLE'),
    Result: Crc32('RESULT'),
    Success: Crc32('SUCCESS'),
    UserData: Crc32('USERDATA'),
    CountObserved: 0xbca73cb1,
    EntryA: 0x5b1c9f30,
    EntryB: 0xd51dc516,
    EntryC: 0x4a1e5e4e,
    EntryD: 0xfbe39f76,
    EntryE: 0x7a0ded2a,
    EntryDate: 0x36eb3854,
});
