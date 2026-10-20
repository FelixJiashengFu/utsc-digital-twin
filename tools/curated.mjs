// Hand-curated facts for UTSC buildings, keyed by OpenStreetMap element (w = way, r = relation).
// Geometry and most floor counts come from OSM; everything here was checked against the sources
// listed in SOURCES (October 2026). Codes are those of the official UTSC campus map (v18, 2024).
//
// fields: code, en/zh names, cat (category key), year (for the timeline), when {en, zh} (display),
//         levels / height (m) overrides with hs = height source ('osm' | 'official' | 'est'),
//         arch (architects), desc {en, zh}, status {en, zh}, facade, color, roof, roofColor, isNew

export const CATEGORIES = {
  teach: { en: 'Teaching & research', zh: '教学科研', color: '#3d6fd6' },
  library: { en: 'Library, arts & admin', zh: '图书馆·艺术·行政', color: '#8a5bd3' },
  student: { en: 'Student life', zh: '学生生活', color: '#ef8a2b' },
  res: { en: 'Residence', zh: '学生住宿', color: '#e3b11a' },
  sport: { en: 'Athletics', zh: '体育', color: '#2e9e66' },
  health: { en: 'Health sciences', zh: '健康科学', color: '#dc4458' },
  heritage: { en: 'Heritage', zh: '历史建筑', color: '#9b6a40' },
  ops: { en: 'Parking & operations', zh: '停车与运营', color: '#76808f' },
  partner: { en: 'Partner institution', zh: '合作院校', color: '#1b9e9e' },
};

const TOWNHOUSE = (letter, name, zh, phase, year) => ({
  code: letter, en: `${name} Hall`, zh: `${zh}楼（联排宿舍）`, cat: 'res', year,
  when: { en: String(year), zh: `${year} 年` }, levels: 2, hs: 'est', facade: 'townhouse', color: '#8d6a50',
  desc: {
    en: `Townhouse residence, phase ${phase} of UTSC's original residence village. Townhouses are named after trees.`,
    zh: `联排式学生宿舍，属于 UTSC 早期宿舍区第 ${phase} 期。联排宿舍都以树木命名。`,
  },
});

export const BUILDINGS = {
  // ---------------------------------------------------------------- the Andrews Building (1964)
  r19919633: { group: true, en: 'Andrews Building', zh: '安德鲁斯楼' },
  w660073634: {
    code: 'SW', en: 'Science Wing', zh: '科学翼楼', cat: 'teach', year: 1964, when: { en: '1964', zh: '1964 年' },
    group: 'r19919633', arch: 'John Andrews', facade: 'brutalist', color: '#b9b4aa',
    desc: {
      en: 'Half of the Brutalist Andrews Building, the original Scarborough College (first classes 1965). Its "indoor streets" step down the edge of the Highland Creek ravine; the building has appeared in films such as Total Recall, Pacific Rim and The Shape of Water.',
      zh: '粗野主义建筑安德鲁斯楼的一半，也是最初的士嘉堡学院（1965 年开课）。楼内的“室内街道”沿 Highland Creek 河谷边缘逐级下降；这座楼出现在《全面回忆》《环太平洋》《水形物语》等电影中。',
    },
  },
  w660074766: {
    code: 'HW', en: 'Humanities Wing', zh: '人文翼楼', cat: 'teach', year: 1964, when: { en: '1964', zh: '1964 年' },
    group: 'r19919633', arch: 'John Andrews', facade: 'brutalist', color: '#b6b1a7',
    desc: {
      en: 'The other half of the Andrews Building, joined to the Science Wing by the Meeting Place, a central atrium under a coffered concrete skylight.',
      zh: '安德鲁斯楼的另一半，通过 Meeting Place 与科学翼楼相连——那是一个顶着混凝土格子天窗的中央中庭。',
    },
  },
  w660074730: {
    code: 'BV', en: 'Bladen Wing', zh: '布莱登翼楼', cat: 'teach', year: 1972, when: { en: '1972', zh: '1972 年' },
    facade: 'brutalist', color: '#b3aea3',
    desc: {
      en: 'Completed in 1972 and named after Vincent Bladen. It once housed the library; the underground Hall of Excellence (1995) links it to the Humanities Wing.',
      zh: '1972 年建成，以 Vincent Bladen 命名，曾是图书馆所在地；1995 年建成的地下通道 Hall of Excellence 把它与人文翼楼连在一起。',
    },
  },
  // ---------------------------------------------------------------- 2000s core
  w660073370: {
    code: 'AC', en: 'Academic Resource Centre', zh: '学术资源中心', cat: 'library', year: 2003, when: { en: '2003', zh: '2003 年' },
    facade: 'copper', color: '#9c6b4e',
    desc: {
      en: 'The copper-clad heart of the campus: the UTSC Library, a lecture theatre of about 500 seats, and the Doris McCarthy Gallery on the upper level.',
      zh: '校园中心那座铜皮外墙的楼：UTSC 图书馆、约 500 座的阶梯教室，楼上是 Doris McCarthy 美术馆。',
    },
  },
  w27082948: {
    code: 'AA', en: 'Arts & Administration Building', zh: '艺术与行政楼', cat: 'library', year: 2005, when: { en: '2005', zh: '2005 年' },
    arch: 'Montgomery Sisam Architects', facade: 'punched', color: '#cdc5b6',
    desc: { en: 'Completed in 2005; home to the Principal\'s office.', zh: '2005 年建成，校长办公室所在地。' },
  },
  w660073620: {
    code: 'SL', en: 'Student Centre', zh: '学生中心', cat: 'student', year: 2004, when: { en: '2004', zh: '2004 年' },
    facade: 'curtain', color: '#c8bca9',
    desc: {
      en: 'Opened in 2004: the student union, food court, health and wellness centre, and prayer space.',
      zh: '2004 年启用：学生会、美食广场、健康中心和祈祷室都在这里。',
    },
  },
  w660074867: {
    code: 'KW', en: 'Kina Wiiya Enadong Building', zh: 'Kina Wiiya Enadong 楼', cat: 'teach', year: 2004, when: { en: '2004', zh: '2004 年' },
    facade: 'punched', color: '#c3b6a3',
    desc: {
      en: 'Opened in 2004 as the Management Wing (MW), later the Social Sciences Building. In December 2023 it was renamed in Anishinaabemowin; Elder Josh Eshkawkogan proposed the name, often translated as "everyone, spirit, mind".',
      zh: '2004 年作为管理翼楼（MW）启用，后来改称社会科学楼。2023 年 12 月改用阿尼什纳比语命名，名字由长老 Josh Eshkawkogan 提出，意为“众人·心灵·精神所在”。',
    },
  },
  w660073518: {
    code: 'SY', en: 'Science Research Building', zh: '科学研究楼', cat: 'teach', year: 2008, when: { en: '2008', zh: '2008 年' },
    levels: 3, hs: 'est', facade: 'punched', color: '#bdb7ab',
    desc: {
      en: 'Research laboratories and a lecture hall, opened in 2008 as an extension of the Science Wing.',
      zh: '2008 年启用的科研实验楼，附设一间阶梯教室，是科学翼楼的扩建部分。',
    },
  },
  r2916427: {
    code: 'IC', en: 'Instructional Centre', zh: '教学中心', cat: 'teach', year: 2011, when: { en: '2011', zh: '2011 年' },
    facade: 'curtain', color: '#a9aeb3',
    desc: {
      en: 'Completed in 2011 with funding from Canada\'s Economic Action Plan: lecture halls, classrooms and study space north of Ellesmere Road.',
      zh: '2011 年建成，由加拿大经济行动计划资助：Ellesmere Road 以北的大小教室和自习空间。',
    },
  },
  w4958554: {
    code: 'HL', en: 'Highland Hall', zh: '高地楼', cat: 'student', year: 2018, when: { en: '2018', zh: '2018 年' },
    facade: 'curtain', color: '#c7c1b3',
    desc: {
      en: 'The campus "front door" on Military Trail, built over the footprint of the old 1970s gym and opened in stages from September 2018: registrar, admissions, classrooms, a lecture hall and an event centre.',
      zh: 'Military Trail 边上的校园“正门”，建在 1970 年代旧体育馆的位置上，2018 年 9 月起分阶段启用：注册处、招生办、教室、阶梯教室和活动中心。',
    },
  },
  w660307913: {
    code: 'EV', en: 'Environmental Science & Chemistry Building', zh: '环境科学与化学楼', cat: 'teach', year: 2015, when: { en: '2015', zh: '2015 年' },
    facade: 'curtain', color: '#9fa5a9',
    desc: {
      en: 'Completed in summer 2015 for the Department of Physical & Environmental Sciences; the third building on the north campus.',
      zh: '2015 年夏建成，物理与环境科学系所在地，是北校区的第三座楼。',
    },
  },
  // ---------------------------------------------------------------- 2023–2026: the newest campus
  w1268545247: {
    code: 'N', en: 'Harmony Commons', zh: '和谐苑学生宿舍', cat: 'res', year: 2023, when: { en: 'Sept 2023', zh: '2023 年 9 月' },
    arch: 'Handel Architects', facade: 'residential', color: '#8f8b86', isNew: true,
    desc: {
      en: 'Nine-storey residence with 746 beds and a dining hall, opened in September 2023. It is the largest building in Canada certified to the Passive House Classic standard.',
      zh: '九层学生宿舍，746 个床位，带食堂，2023 年 9 月启用。它是加拿大获得“被动房 Classic”认证的最大建筑。',
    },
  },
  w1265894595: {
    code: 'IA', en: 'Sam Ibrahim Building', zh: '萨姆·易卜拉欣楼', cat: 'teach', year: 2024, when: { en: 'Fall 2024', zh: '2024 年秋' },
    height: 27.1, hs: 'official', arch: 'CEBRA', facade: 'curtain', color: '#dcd6cb', isNew: true,
    desc: {
      en: 'Five storeys, planned as "Instructional Centre 2". In use since fall 2024 and formally opened in April 2025: 20 technology-enabled classrooms, the Department of Computer & Mathematical Sciences, the Sam Ibrahim Centre for Inclusive Excellence, and consolidated student services. Heated and cooled with geothermal energy.',
      zh: '五层，原规划名“第二教学中心”。2024 年秋投入使用，2025 年 4 月正式揭幕：20 间智能教室、计算机与数学科学系、Sam Ibrahim 包容卓越中心，以及集中的学生服务。采用地热供暖制冷。',
    },
  },
  w1501647882: {
    code: 'IH', en: 'Indigenous House', zh: '原住民之家', cat: 'student', year: 2026, when: { en: 'May 2026', zh: '2026 年 5 月' },
    levels: 2, hs: 'official', arch: 'Formline Architecture + Urbanism, LGA Architectural Partners', facade: 'timber', color: '#b08a5c', isNew: true,
    desc: {
      en: 'Opened on May 25, 2026. A two-storey, roughly 1,000 m² ovoid building wrapped in curved glulam timber, with circular gathering spaces at each end, a ramp lined with medicinal plants up to a viewing deck, and a sunken learning garden. A home for ceremony, teaching and student support.',
      zh: '2026 年 5 月 25 日启用。两层、约 1000 平方米的椭圆形建筑，外覆弧形胶合木；两端是圆形聚会厅，一条种着药用植物的坡道通往观景平台，旁边有下沉式学习花园。用于仪式、教学和学生支持。',
    },
  },
  w1500323725: {
    code: 'AM', en: 'Garron Health Sciences Complex (SAMIH)', zh: '加伦健康科学综合楼（SAMIH）', cat: 'health', year: 2026, when: { en: 'Sept 2026', zh: '2026 年 9 月' },
    levels: 6, height: 32, hs: 'official', arch: 'MVRDV, Diamond Schmitt Architects', facade: 'curtain', color: '#e4e0d8', isNew: true,
    desc: {
      en: 'The Myron and Berna Garron Health Sciences Complex, home of the Scarborough Academy of Medicine and Integrated Health. Six storeys and 32 m: anatomy lab, clinical skills lab, instructional labs and teaching clinics open to the public. The first cohorts (physician assistant, physiotherapy, nurse practitioner) arrived in fall 2026; the first 40 MD students start in 2027.',
      zh: 'Myron 与 Berna Garron 健康科学综合楼，士嘉堡医学与综合健康学院（SAMIH）所在地。六层、32 米：解剖实验室、临床技能实验室、教学实验室，以及对公众开放的教学诊所。2026 年秋迎来首批医师助理、物理治疗和执业护士学生；首批 40 名医学博士（MD）学生 2027 年入学。',
    },
    status: { en: 'Open to students since fall 2026; exterior cladding being finished (Oct 2026).', zh: '2026 年秋已迎来学生；外立面收尾中（2026 年 10 月）。' },
  },
  w1504558741: {
    code: 'PC', en: 'Retail and Parking Commons', zh: '零售与停车综合楼', cat: 'ops', year: 2026, when: { en: '2026', zh: '2026 年' },
    levels: 6, height: 23.5, hs: 'official', arch: 'Behnisch Architekten, gh3*', facade: 'parking', color: '#c6c1b7', isNew: true,
    desc: {
      en: 'A six-storey, 23.5 m parking structure with about 1,090 spaces (217 with EV chargers) over ground-floor shops, a new home for the campus bookstore, and Campus Safety and Parking Services. Built from June 2024 and designed to be adaptable to other uses later.',
      zh: '六层、23.5 米的停车楼，约 1090 个车位（其中 217 个带电动车充电桩），底层是商铺、新的校园书店，以及校园安全与停车服务处。2024 年 6 月开工，设计上预留了日后改作他用的可能。',
    },
    status: { en: 'Parking open (Oct 2026); ground-floor shops opening soon.', zh: '停车场已开放（2026 年 10 月）；底层商铺即将开业。' },
  },
  // ---------------------------------------------------------------- athletics
  w185369754: {
    code: 'AQ', en: 'Toronto Pan Am Sports Centre', zh: '多伦多泛美运动中心', cat: 'sport', year: 2014, when: { en: '2014', zh: '2014 年' },
    height: 18, hs: 'est', facade: 'curtain', color: '#b7c0c7',
    desc: {
      en: 'Built for the 2015 Pan Am and Parapan Am Games and co-owned by the City of Toronto and U of T: two 50 m pools, a diving tank, a field house, a fitness centre and a climbing wall.',
      zh: '为 2015 年泛美运动会和泛美残疾人运动会而建，由多伦多市和多伦多大学共同拥有：两个 50 米泳池、跳水池、室内田径场、健身中心和攀岩墙。',
    },
  },
  // ---------------------------------------------------------------- residences
  w27082929: {
    code: 'JF', en: 'Joan Foley Hall', zh: '琼·福利楼（宿舍）', cat: 'res', year: 2003, when: { en: '2003', zh: '2003 年' },
    facade: 'residential', color: '#b0896b',
    desc: { en: 'Suite-style residence opened in 2003: 58 suites for up to 229 students.', zh: '2003 年启用的套间式宿舍：58 个套间，最多住 229 名学生。' },
  },
  w27082928: {
    code: 'SRC', en: 'Student Residence Centre', zh: '宿舍服务中心', cat: 'res',
    facade: 'punched', color: '#4f7fb2',
    desc: { en: 'The blue building beside Joan Foley Hall: residence offices and common space.', zh: '琼·福利楼旁边那座蓝色的楼：宿舍办公室和公共空间。' },
  },
  w27082930: TOWNHOUSE('A', 'Aspen', '白杨', 1, 1973),
  w27082932: TOWNHOUSE('B', 'Birch', '白桦', 1, 1973),
  w27082933: TOWNHOUSE('C', 'Cedar', '雪松', 1, 1973),
  w27082934: TOWNHOUSE('D', 'Dogwood', '山茱萸', 1, 1973),
  w27082931: TOWNHOUSE('E', 'Elm', '榆树', 1, 1973),
  w27082936: TOWNHOUSE('G', 'Grey Pine', '灰松', 2, 1984),
  w27082937: TOWNHOUSE('H', 'Hickory', '山核桃', 2, 1984),
  w324290439: TOWNHOUSE('H', 'Hickory', '山核桃', 2, 1984),
  w27082935: TOWNHOUSE('I', 'Ironwood', '铁木', 2, 1984),
  w660212111: TOWNHOUSE('J', 'Juniper', '杜松', 3, 1989),
  w660073749: TOWNHOUSE('K', 'Koa', '寇阿', 3, 1989),
  w27082732: TOWNHOUSE('L', 'Larch', '落叶松', 3, 1989),
  w27082731: TOWNHOUSE('M', 'Maple', '枫树', 3, 1989),
  // ---------------------------------------------------------------- services
  w27082950: {
    code: 'CC', en: "N'sheemaehn Child Care Centre", zh: "N'sheemaehn 托儿中心", cat: 'student', year: 1990, when: { en: '1990', zh: '1990 年' },
    facade: 'punched', color: '#c9a77c',
    desc: { en: 'Non-profit child care centre on campus, opened in 1990.', zh: '校内的非营利托儿中心，1990 年开办。' },
  },
  w1059440940: { code: 'PO', en: 'Portable', zh: '临时教室', cat: 'ops', levels: 1, hs: 'est', facade: 'punched', color: '#c9c3b8', desc: { en: 'Portable building.', zh: '活动板房。' } },
  w660073741: { en: 'Maintenance Building', zh: '维修楼', cat: 'ops', facade: 'punched', color: '#a8a39a', desc: { en: 'Grounds and maintenance building in the valley.', zh: '河谷里的校园维护用房。' } },
  w1302731679: { en: 'Bike Share Shed', zh: '共享单车棚', cat: 'ops', facade: 'shed', color: '#7b8a6a', desc: { en: 'Covered shed for the UTSC community bike-share program: 48 bikes, including cargo bikes.', zh: 'UTSC 社区共享单车项目的车棚：48 个车位，包括载货自行车。' } },
  // ---------------------------------------------------------------- the Miller Lash estate (1913–14), in the valley
  w27082947: {
    code: 'ML', en: 'Miller Lash House', zh: '米勒·拉什宅邸', cat: 'heritage', year: 1914, when: { en: '1913–14', zh: '1913–14 年' },
    levels: 2, hs: 'est', arch: 'attributed to Edward B. Green (Buffalo)', facade: 'stone', color: '#9d9a93', roof: 'hipped', roofColor: '#8f3b2c',
    desc: {
      en: 'Arts and Crafts country house of the Miller Lash estate on Highland Creek, built about 1913–14. The university acquired the land in 1963; the 17-room house later served as the principal\'s residence and now hosts university events.',
      zh: '米勒·拉什庄园的工艺美术风格乡间宅邸，位于 Highland Creek 河畔，约建于 1913–14 年。大学在 1963 年买下这片土地；这座 17 个房间的宅邸后来做过校长官邸，现在用于学校活动。',
    },
  },
  w660073524: {
    code: 'CH', en: 'Coach House', zh: '马车房', cat: 'heritage', year: 1914, when: { en: '1913–14', zh: '1913–14 年' },
    facade: 'stone', color: '#a19c92', roof: 'gabled', roofColor: '#7b3a2e',
    desc: { en: 'Carriage house of the Miller Lash estate, built 1913–14 for Lash\'s cars.', zh: '米勒·拉什庄园的马车房，1913–14 年建，用来停放拉什的汽车。' },
  },
  w1059438875: { code: 'HH', en: 'Harbutt House', zh: 'Harbutt 小屋', cat: 'heritage', levels: 2, hs: 'est', facade: 'punched', color: '#c2b49c', roof: 'gabled', roofColor: '#5d5550', desc: { en: 'House in the valley next to the UTSC Tennis Centre.', zh: '河谷里、UTSC 网球中心旁的小屋。' } },
  // ---------------------------------------------------------------- partner
  w660212115: {
    en: 'Centennial College – Morningside Campus', zh: '百年理工学院 Morningside 校区', cat: 'partner',
    facade: 'curtain', color: '#b5aea3',
    desc: { en: 'Centennial College\'s campus at 755 Morningside Avenue, inside the UTSC grounds; the two schools run joint programs.', zh: '百年理工学院位于 Morningside Ave 755 号的校区，坐落在 UTSC 校园内；两校合办联合课程。' },
  },
};

// Named outdoor places from the official map that OSM does not name the same way.
export const PLACE_ZH = {
  'Highland Creek': '高地溪', 'West Highland Creek': '西高地溪', 'Ellesmere Creek': 'Ellesmere 溪',
  'The Valley': '河谷', 'Highland Creek Ravine': '高地溪峡谷公园', 'Dan Lang Field': '丹·朗棒球场',
  'Campus Farm': '校园农场', 'UTSC Agriculture Garden': '社区菜园', 'UTSC Tennis Centre': 'UTSC 网球中心',
  'Sakura Grove': '樱花林', 'Gathering Circle': '聚会圈', 'Morningside Park': 'Morningside 公园',
  'Morningside Athletic Field': 'Morningside 运动场', 'Highland Creek Community Park': '高地溪社区公园',
  'Colonel Danforth Park': 'Danforth 上校公园', 'Megan Park': 'Megan 公园', 'Ellesmere Greenspace': 'Ellesmere 绿地',
  'Mornelle Commons': 'Mornelle 公共绿地', 'Bonspiel Park': 'Bonspiel 公园', 'Fred Urquart Memorial Garden': 'Fred Urquart 纪念花园',
  'Valley Lot': '河谷停车场', 'North Lot': '北停车场', 'East Lot': '东停车场', 'Mornelle Visitor Car Park': 'Mornelle 访客停车场',
  'Morningside Yard': 'Morningside 车场', 'SmartCentres Scarborough (E)': 'SmartCentres 购物中心',
  'Tam Heather Curling & Tennis Club': 'Tam Heather 冰壶与网球俱乐部', 'Highland Creek Sports Pad': '高地溪运动场',
  'Valley Athletic Fields': '河谷运动场', 'Ma Moosh Ka Win Valley Trail': 'Ma Moosh Ka Win 河谷步道',
};

export const SOURCES = [
  ['UTSC campus map v18 (Feb 2024) — building codes', 'https://utsc.utoronto.ca/food/sites/utsc.utoronto.ca.food/files/docs/UTSC_Campus_Map_1.pdf'],
  ['Wikipedia: University of Toronto Scarborough', 'https://en.wikipedia.org/wiki/University_of_Toronto_Scarborough'],
  ['Wikipedia: Andrews Building', 'https://en.wikipedia.org/wiki/Andrews_Building'],
  ['Skyrise Cities, Oct 2026: SAMIH welcomes students; Retail and Parking Commons complete', 'https://toronto.skyrisecities.com/news/2026/10/utsc-medical-academy-welcomes-students-exterior-work-wraps.61893'],
  ['UrbanToronto, May 2026: Indigenous House opens', 'https://urbantoronto.ca/news/2026/05/indigenous-house-opens-u-t-scarborough.61079'],
  ['U of T News: Indigenous House groundbreaking', 'https://utoronto.ca/news/inclusive-space-u-t-scarborough-breaks-ground-indigenous-house'],
  ['U of T: opening of the Sam Ibrahim Building (Apr 2025)', 'https://defygravitycampaign.utoronto.ca/?p=19167'],
  ['UTSC Residences: Harmony Commons', 'https://www.utsc.utoronto.ca/bosa/node/153'],
  ['UTSC: Kina Wiiya Enadong Building', 'https://www.utsc.utoronto.ca/indigenous-place-making/kina-wiiya-enadong-building'],
  ['UTSC BOSA: Retail and Parking Commons', 'https://www.utsc.utoronto.ca/bosa/retail-and-parking-commons'],
  ['U of T Magazine: Highland Hall', 'https://magazine.utoronto.ca/campus/places/a-new-front-door-for-utsc-highland-hall'],
  ['Doris McCarthy Gallery: visiting', 'https://dorismccarthygallery.utoronto.ca/about/visiting'],
];
