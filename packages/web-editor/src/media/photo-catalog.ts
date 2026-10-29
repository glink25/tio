interface Photo {
  id: string;
  image: string;
  name: string;
  user: string;
  source: string;
}

export const photoCategories = [
  {
    id: 'landscapes',
    photos: [
      {
        id: 'lake',
        image: 'photo-1470770841072-f978cf4d019e',
        name: 'Luca Bravo',
        user: 'lucabravo',
        source: 'https://unsplash.com/photos/zAjdgNXsMeg',
      },
      {
        id: 'mountain',
        image: 'photo-1464822759023-fed622ff2c3b',
        name: 'Kalen Emsley',
        user: 'kalenemsley',
        source: 'https://unsplash.com/photos/Bkci_8qcdvQ',
      },
      {
        id: 'alpine-river',
        image: 'photo-1516655855035-d5215bcb5604',
        name: 'Mark Koch',
        user: 'markk92',
        source: 'https://unsplash.com/photos/river-near-mountains-KiRlN3jjVNU',
      },
      {
        id: 'snowy-lake',
        image: 'photo-1503614472-8c93d56e92ce',
        name: 'John Lee',
        user: 'john_artifexfilm',
        source: 'https://unsplash.com/photos/scenery-of-mountain-oMneOBYhJxY',
      },
      {
        id: 'turquoise-lake',
        image: 'photo-1559310589-2673bfe16970',
        name: 'Adam Vradenburg',
        user: 'vradenburg',
        source:
          'https://unsplash.com/photos/turquoise-lake-reflecting-snow-capped-mountains-GA09PKfRIQY',
      },
      {
        id: 'green-valley',
        image: 'photo-1603979649806-5299879db16b',
        name: 'Ansgar Scheffold',
        user: 'ansgarscheffold',
        source: 'https://unsplash.com/photos/lake-in-the-middle-of-green-mountains-z_f2JrBRbOg',
      },
      {
        id: 'lakeside-trees',
        image: 'photo-1583244685026-d8519b5e3d21',
        name: 'Claudia Chiavazza',
        user: 'chiclaudia',
        source: 'https://unsplash.com/photos/green-trees-beside-lake-during-daytime-N9vsB6OEeKM',
      },
      {
        id: 'alpine-reflection',
        image: 'photo-1600298882525-1ac025c98b68',
        name: 'Nathan Dumlao',
        user: 'nate_dumlao',
        source:
          'https://unsplash.com/photos/green-trees-near-snow-covered-mountain-during-daytime-q3YZ4g7j9yc',
      },
    ],
  },
  {
    id: 'plants',
    photos: [
      {
        id: 'forest',
        image: 'photo-1441974231531-c6227db76b6e',
        name: 'Lukasz Szmigiel',
        user: 'szmigieldesign',
        source: 'https://unsplash.com/photos/jFCViYFYcus',
      },
      {
        id: 'sunlit-forest',
        image: 'photo-1448375240586-882707db888b',
        name: 'Sebastian Unrau',
        user: 'sebastian_unrau',
        source: 'https://unsplash.com/photos/trees-on-forest-with-sun-rays-sp-p7uuT0tw',
      },
      {
        id: 'forest-aerial',
        image: 'photo-1542273917363-3b1817f69a2d',
        name: 'Marita Kavelashvili',
        user: 'maritaextrabold',
        source: 'https://unsplash.com/photos/aerial-photo-of-green-trees-ugnrXk1129g',
      },
      {
        id: 'tall-trees',
        image: 'photo-1425913397330-cf8af2ff40a1',
        name: 'Steven Kamenar',
        user: 'skamenar',
        source: 'https://unsplash.com/photos/photography-of-tall-trees-at-daytime-MMJx78V7xS8',
      },
      {
        id: 'pine-sunset',
        image: 'photo-1511497584788-876760111969',
        name: 'Sergei A',
        user: 'sakulich',
        source:
          'https://unsplash.com/photos/pine-trees-field-near-mountain-under-sunset--heLWtuAN3c',
      },
      {
        id: 'green-woodland',
        image: 'photo-1542202229-7d93c33f5d07',
        name: 'Irina Iriser',
        user: 'iriser',
        source: 'https://unsplash.com/photos/green-leafed-trees-2Y4dE8sdhlc',
      },
      {
        id: 'green-leaves',
        image: 'photo-1470058869958-2a77ade41c02',
        name: 'Chris Abney',
        user: 'chrisabney',
        source: 'https://unsplash.com/photos/area-covered-with-green-leafed-plants-qLW70Aoo8BE',
      },
      {
        id: 'plant-study',
        image: 'photo-1501004318641-b39e6451bec6',
        name: 'Igor Son',
        user: 'igorson',
        source: 'https://unsplash.com/photos/green-leaf-plant-FV_PxCqgtwc',
      },
    ],
  },
  {
    id: 'coasts',
    photos: [
      {
        id: 'ocean-horizon',
        image: 'photo-1518837695005-2083093ee35b',
        name: 'Matt Hardy',
        user: 'matthardy',
        source: 'https://unsplash.com/photos/body-of-water-under-sky-6ArTTluciuA',
      },
      {
        id: 'golden-beach',
        image: 'photo-1507525428034-b723cf961d3e',
        name: 'Sean Oulashin',
        user: 'oulashin',
        source: 'https://unsplash.com/photos/seashore-during-golden-hour-KMn4VEeEPR8',
      },
      {
        id: 'blue-sea',
        image: 'photo-1468581264429-2548ef9eb732',
        name: 'Thomas Vimare',
        user: 'vimarethomas',
        source:
          'https://unsplash.com/photos/body-of-water-under-blue-and-white-sky-at-daytime-IZ01rjX0XQA',
      },
      {
        id: 'clear-water',
        image: 'photo-1530053969600-caed2596d242',
        name: 'Cristian Palmer',
        user: 'cristianpalmer',
        source: 'https://unsplash.com/photos/clear-blue-body-of-water-XexawgzYOBc',
      },
      {
        id: 'ocean-surface',
        image: 'photo-1507166763745-bfe008fbb831',
        name: 'Conor Sexton',
        user: 'conorsexton',
        source: 'https://unsplash.com/photos/body-of-water-during-daytime-hRemch0ZDwI',
      },
      {
        id: 'coastal-cliffs',
        image: 'photo-1510414842594-a61c69b5ae57',
        name: 'Derek Thomson',
        user: 'derekthomson',
        source:
          'https://unsplash.com/photos/body-of-water-near-trees-and-mountain-cliff-during-daytime-TWoL-QCZubY',
      },
      {
        id: 'seabirds',
        image: 'photo-1471922694854-ff1b63b20054',
        name: 'frank mckenna',
        user: 'frankiefoto',
        source: 'https://unsplash.com/photos/five-birds-flying-on-the-sea-OD9EOzfSOh0',
      },
      {
        id: 'quiet-shore',
        image: 'photo-1473116763249-2faaef81ccda',
        name: 'Camille Minouflet',
        user: 'caminouflet',
        source: 'https://unsplash.com/photos/photo-of-seashore-d7M5Xramf8g',
      },
    ],
  },
  {
    id: 'cities',
    photos: [
      {
        id: 'skyscrapers',
        image: 'photo-1486406146926-c627a92ad1ab',
        name: 'Sean Pollock',
        user: 'seanpollock',
        source:
          'https://unsplash.com/photos/low-angle-photo-of-city-high-rise-buildings-during-daytime-PhYq704ffdA',
      },
      {
        id: 'concrete-geometry',
        image: 'photo-1488972685288-c3fd157d7c7a',
        name: 'Anders Jildén',
        user: 'andersjilden',
        source:
          'https://unsplash.com/photos/low-angle-photography-of-gray-building-at-daytime-Sc5RKXLBjGg',
      },
      {
        id: 'wavy-facade',
        image: 'photo-1493397212122-2b85dda8106b',
        name: 'Maarten Deckers',
        user: 'maartendeckers',
        source:
          'https://unsplash.com/photos/a-building-with-wavy-lines-on-it-against-a-blue-sky-T5nXYXCf50I',
      },
      {
        id: 'white-architecture',
        image: 'photo-1487958449943-2429e8be8625',
        name: 'Lance Anderson',
        user: 'lanceanderson',
        source: 'https://unsplash.com/photos/rock-and-roll-hall-of-fame-cleveland-QdAAasrZhdk',
      },
      {
        id: 'urban-lines',
        image: 'photo-1435575653489-b0873ec954e2',
        name: 'Verne Ho',
        user: 'verneho',
        source: 'https://unsplash.com/photos/worms-eye-view-of-building-during-daytime-0LAJfSNa-xQ',
      },
      {
        id: 'high-rise',
        image: 'photo-1617375819318-67968e5b25c3',
        name: 'Sirisvisual',
        user: 'sirisvisual',
        source:
          'https://unsplash.com/photos/low-angle-photography-of-high-rise-buildings-J4M9FKPEaUA',
      },
      {
        id: 'building-pattern',
        image: 'photo-1554793000-245d3a3c2a51',
        name: 'Peter Ivey-Hansen',
        user: 'peteriveyphotography',
        source: 'https://unsplash.com/photos/brown-building-structure-5xOSA-UgsKQ',
      },
      {
        id: 'city-canal',
        image: 'photo-1519144905-e2eee299f508',
        name: 'Tim Lumley',
        user: 'timlumley',
        source:
          'https://unsplash.com/photos/beige-boat-on-body-of-water-between-buildings-MgpnLIOcXQM',
      },
    ],
  },
  {
    id: 'skies',
    photos: [
      {
        id: 'milky-way',
        image: 'photo-1528353518104-dbd48bee7bc4',
        name: 'Chan Hoi',
        user: 'jokerhoi',
        source: 'https://unsplash.com/photos/milky-way-over-dark-mountain-silhouettes-uj-w-v7OFT4',
      },
      {
        id: 'star-field',
        image: 'photo-1475274047050-1d0c0975c63e',
        name: 'Paul Lichtblau',
        user: 'laup',
        source: 'https://unsplash.com/photos/cluster-of-stars-in-the-sky-qVotvbsuM_c',
      },
      {
        id: 'forest-stars',
        image: 'photo-1444080748397-f442aa95c3e5',
        name: 'Ryan Hutton',
        user: 'ryan_hutton_',
        source: 'https://unsplash.com/photos/worms-eye-view-of-trees-during-night-time-Jztmx9yqjBw',
      },
      {
        id: 'night-mountains',
        image: 'photo-1488866022504-f2584929ca5f',
        name: 'Nathan Anderson',
        user: 'nathananderson',
        source:
          'https://unsplash.com/photos/milky-way-over-mountain-landscape-at-night-L95xDkSSuWw',
      },
      {
        id: 'white-clouds',
        image: 'photo-1603437873662-dc1f44901825',
        name: 'engin akyurt',
        user: 'enginakyurt',
        source:
          'https://unsplash.com/photos/white-clouds-under-blue-sky-during-daytime-gJILnne_HFg',
      },
      {
        id: 'blue-sky',
        image: 'photo-1601370552761-d129028bd833',
        name: 'engin akyurt',
        user: 'enginakyurt',
        source: 'https://unsplash.com/photos/white-clouds-and-blue-sky-during-daytime-A9_IsUtjHm4',
      },
      {
        id: 'cloudscape',
        image: 'photo-1501630834273-4b5604d2ee31',
        name: 'Billy Huynh',
        user: 'billy_huy',
        source: 'https://unsplash.com/photos/cloudy-sky-at-daytime-v9bnfMCyKbg',
      },
      {
        id: 'soft-clouds',
        image: 'photo-1542349314-b0ceb4d90f2d',
        name: 'CHUTTERSNAP',
        user: 'chuttersnap',
        source: 'https://unsplash.com/photos/clouds-during-daytime-M2-_GRvWWg0',
      },
    ],
  },
  {
    id: 'textures',
    photos: [
      {
        id: 'monochrome-texture',
        image: 'photo-1568733873715-f9d497a47ea0',
        name: 'Hulki Okan Tabak',
        user: 'hulkiokantabak',
        source: 'https://unsplash.com/photos/grey-and-black-illustration-x3kQTL7yw30',
      },
      {
        id: 'teal-curves',
        image: 'photo-1669295384050-a1d4357bd1d7',
        name: 'Pawel Czerwinski',
        user: 'pawel_czerwinski',
        source: 'https://unsplash.com/photos/teal-curved-wallpaper-ERcQ81KaX9g',
      },
      {
        id: 'water-blur',
        image: 'photo-1768300835487-f4711bf749de',
        name: 'Robert Clark',
        user: 'robert_clark',
        source:
          'https://unsplash.com/photos/abstract-blur-of-green-and-blue-water-waves-XKaHnkxBc1w',
      },
      {
        id: 'color-folds',
        image: 'photo-1618005182384-a83a8bd57fbe',
        name: 'Milad Fakurian',
        user: 'fakurian',
        source: 'https://unsplash.com/photos/blue-orange-and-yellow-wallpaper-E8Ufcyxz514',
      },
      {
        id: 'violet-flow',
        image: 'photo-1620121692029-d088224ddc74',
        name: 'Richard Horvath',
        user: 'ricvath',
        source: 'https://unsplash.com/photos/deep-blue-and-purple-flowing-shapes-_nWaeTF6qo0',
      },
      {
        id: 'pastel-spheres',
        image: 'photo-1618005198919-d3d4b5a92ead',
        name: 'Milad Fakurian',
        user: 'fakurian',
        source: 'https://unsplash.com/photos/pastel-spheres-on-gradient-background-PGdW_bHDbpI',
      },
      {
        id: 'golden-lines',
        image: 'photo-1513346940221-6f673d962e97',
        name: 'Rene Böhmer',
        user: 'qrenep',
        source:
          'https://unsplash.com/photos/a-very-long-line-of-yellow-lines-on-a-black-background-YeUVDKZWSZ4',
      },
      {
        id: 'gray-texture',
        image: 'photo-1760216269289-4acc06056185',
        name: 'MARIOLA GROBELSKA',
        user: 'mariolagr',
        source:
          'https://unsplash.com/photos/a-textured-grey-background-with-subtle-gradient-fEpxC7WkIAU',
      },
    ],
  },
] as const satisfies readonly { id: string; photos: readonly Photo[] }[];

export type CoverPhoto = (typeof photoCategories)[number]['photos'][number];
