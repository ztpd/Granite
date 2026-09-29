// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('node:zlib');
const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const Fields = Object.freeze({
    LayoutJsonSize: 0x6cb1bd26,
    LayoutJsonCompressed: 0xe1e79306,
});

const Sections = Object.freeze({
    NBASTORE: [
        ['NBA_SHIRTS_ALL', 'NBA Shirts'],
        ['NBA_MITCHELL_NESS', 'Mitchell & Ness'],
        ['NBA_OTHER_TEAM_HATS', 'Team Hats'],
        ['NBA_ACCESSORIES', 'NBA Accessories'],
        ['NBA_GLASSES', 'NBA Glasses'],
        ['NBA_ALLSTAR', 'All-Star'],
        ['NBA_HOLIDAY', 'Holiday'],
        ['NBA_MISC1', 'NBA Collection'],
        ['NBA_MISC2', 'More NBA Gear'],
    ],
    SWAGS: [
        ['SWAG_SHIRTS', 'Shirts'],
        ['SWAG_PREMIUM_SHIRTS', 'Premium Shirts'],
        ['SWAG_HOODIES_AND_OUTERWEAR', 'Hoodies & Outerwear'],
        ['SWAG_PANTS_AND_SHORTS', 'Pants & Shorts'],
        ['SWAG_HATS', 'Hats'],
        ['SWAG_ACCESSORIES', 'Accessories'],
        ['SWAG_JEWELRY', 'Jewelry'],
        ['SWAG_GLASSES', 'Glasses'],
        ['SWAG_EQUIPMENT', 'Equipment'],
        ['SWAG_NIKE', 'Nike'],
        ['SWAG_JORDAN', 'Jordan'],
        ['SWAG_ADIDAS', 'adidas'],
        ['SWAG_PROAM', 'Pro-Am'],
        ['SWAG_HOLIDAY', 'Holiday'],
        ['SWAG_MISC1', 'Collection'],
        ['SWAG_MISC2', 'More Gear'],
    ],
    FOOTLOCKER: [
        ['SHOE_NBA', 'NBA Shoes'],
        ['SHOE_MISC1', 'Shoe Collection'],
        ['SHOE_MISC2', 'More Shoes'],
    ],
});

function LayoutDocument() {
    return Object.fromEntries(
        Object.entries(Sections).map(([Store, SectionsValue]) => {
            const Pages = [];
            for (let Offset = 0; Offset < SectionsValue.length; Offset += 6) {
                const Cells = SectionsValue.slice(Offset, Offset + 6).map(([Category, Title]) => ({
                    store_type: Category,
                    cell_size: 'ONE_THIRD',
                    title: Title,
                    desc: '',
                    logo_guid: '',
                }));
                Pages.push([Cells.slice(0, 3), ...(Cells.length > 3 ? [Cells.slice(3)] : [])]);
            }
            return [Store, Pages];
        }),
    );
}

const Document = Buffer.from(`${JSON.stringify(LayoutDocument())}\0`, 'utf8');
const Compressed = Zlib.deflateSync(Document, { level: 9 });

function Build() {
    return new Builder()
        .AddU64(Fields.LayoutJsonSize, BigInt(Document.length))
        .AddBinary(Fields.LayoutJsonCompressed, Compressed)
        .AddStringCrc(Crc32('RESULT'), Crc32('SUCCESS'))
        .Build();
}

module.exports = {
    Build,
    GetLayout: Build,
    Fields,
    LayoutDocument,
    Status: 'EXACT_2K19_ENVELOPE_COMPATIBILITY_CATEGORY_LAYOUT',
};
