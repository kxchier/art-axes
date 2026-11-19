const films = [
  {
    "title": "My Neighbor Totoro",
    "year": 1988,
    "director": "Hayao Miyazaki",
    "color": "#698765",
    "symbol": "♧",
    "synopsis": "Two sisters move to the countryside with their father while their mother recovers in hospital. They discover forest spirits and find comfort in a magical creature.",
    "poster": "./posters/0.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/rtGDOeG9LzoerkDGZF9dnVeLppL.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/58611129-2dbc-4a81-a72f-77ddfc1b1b49"
  },
  {
    "title": "Spirited Away",
    "year": 2001,
    "director": "Hayao Miyazaki",
    "color": "#a45d52",
    "symbol": "♨",
    "synopsis": "A young girl enters a spirit world after her parents are transformed. Working in a bathhouse, she forms friendships and seeks a way to free her family and return home.",
    "poster": "./posters/1.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/dc2e6bd1-8156-4886-adff-b39e6043af0c"
  },
  {
    "title": "Howl’s Moving Castle",
    "year": 2004,
    "director": "Hayao Miyazaki",
    "color": "#738d9b",
    "symbol": "♜",
    "synopsis": "A young woman transformed into an old woman seeks refuge in a moving castle. With a wizard and a fire spirit, she confronts a curse and a destructive war.",
    "poster": "./posters/2.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/TkTPELv4kC3u1lkloush8skOjE.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/cd3d059c-09f4-4ff3-8d63-bc765a5184fa"
  },
  {
    "title": "Kiki’s Delivery Service",
    "year": 1989,
    "director": "Hayao Miyazaki",
    "color": "#777b9e",
    "symbol": "☾",
    "synopsis": "A young witch leaves home to live independently in a seaside city. She starts a delivery service, makes friends, and struggles to regain confidence and her ability to fly.",
    "poster": "./posters/3.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/7nO5DUMnGUuXrA4r2h6ESOKQRrx.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/ea660b10-85c4-4ae3-8a5f-41cea3648e3e"
  },
  {
    "title": "Princess Mononoke",
    "year": 1997,
    "director": "Hayao Miyazaki",
    "color": "#3f675c",
    "symbol": "❧",
    "synopsis": "A cursed prince travels to a forest where humans and animal gods are at war. He meets a young woman raised by wolves and seeks peace between industry and nature.",
    "poster": "./posters/4.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/jHWmNr7m544fJ8eItsfNk8fs2Ed.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/0440483e-ca0e-4120-8c50-4c8cd9b965d6"
  },
  {
    "title": "Ponyo",
    "year": 2008,
    "director": "Hayao Miyazaki",
    "color": "#c58662",
    "symbol": "≈",
    "synopsis": "A young fish becomes a girl after befriending a boy in a seaside town. Her transformation disrupts the balance of nature, and their friendship faces a magical test.",
    "poster": "./posters/5.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/mikKSEdk5kLhflWXbp4S5mmHsDo.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/758bf02e-3122-46e0-884e-67cf83df1786"
  },
  {
    "title": "Castle in the Sky",
    "year": 1986,
    "director": "Hayao Miyazaki",
    "color": "#648692",
    "symbol": "◇",
    "synopsis": "Two children with a mysterious crystal search for a floating city. Pursued by pirates and soldiers, they discover ancient technology and confront the destructive use of power.",
    "poster": "./posters/6.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/npOnzAbLh6VOIu3naU5QaEcTepo.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/2baf70d1-42bb-4437-b551-e5fed5a87abe"
  },
  {
    "title": "Grave of the Fireflies",
    "year": 1988,
    "director": "Isao Takahata",
    "color": "#8d7752",
    "symbol": "✧",
    "synopsis": "A brother and sister struggle to survive in Japan during the final months of war. After losing their mother and home, they face hunger and isolation.",
    "poster": "./posters/7.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/qG3RYlIVpTYclR9TYIsy8p7m7AT.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/12cfb892-aac0-4c5b-94af-521852e46d6a"
  },
  {
    "title": "Whisper of the Heart",
    "year": 1995,
    "director": "Yoshifumi Kondō",
    "color": "#ac8a73",
    "symbol": "♫",
    "synopsis": "A girl who loves books meets a boy who wants to make violins. Their growing affection inspires her to write a story and consider her own creative ambitions.",
    "poster": "./posters/8.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/5E3Hvbu0bg38ouYf6chGftVGqZ7.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/ff24da26-a969-4f0e-ba1e-a122ead6c6e3"
  },
  {
    "title": "The Wind Rises",
    "year": 2013,
    "director": "Hayao Miyazaki",
    "color": "#879b88",
    "symbol": "⌁",
    "synopsis": "A young man dreams of flight and becomes an aircraft designer in prewar Japan. His creative ambitions and love for a woman unfold as his airplanes become instruments of war.",
    "poster": "./posters/9.jpg",
    "posterSource": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/jfwSexzlIzaOgxP9A8bTA6t8YYb.jpg",
    "metadataSource": "https://ghibliapi.vercel.app/films/67405111-37a5-438f-81cc-4666af60c800"
  }
];
