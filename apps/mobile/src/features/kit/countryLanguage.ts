/**
 * Sprint 14 F-043 (AC-1, AC-2; Raz 2): for each country on the globe (adm0),
 * its region code for limiting the hotel search and the language a taxi
 * driver there reads, for the local name and address on the driver card.
 * Mostly the main official language; where another one is what's on the
 * street signs and in the drivers' hands, that one (Russian in Kazakhstan and
 * Kyrgyzstan, French in Luxembourg, Danish in Greenland). In a country with
 * several, the user edits the field if the hotel is elsewhere (scope, open
 * questions). Territories take their own code where Google knows it.
 */
const TABLE =
  'ABW:AW:nl ALD:AX:sv AFG:AF:fa AGO:AO:pt AIA:AI:en ALB:AL:sq AND:AD:ca ARE:AE:ar ARG:AR:es ' +
  'ARM:AM:hy ASM:AS:en ATA:AQ:en ATC:AU:en ATF:TF:fr ATG:AG:en AUS:AU:en AUT:AT:de AZE:AZ:az ' +
  'BDI:BI:fr BEL:BE:nl BEN:BJ:fr BFA:BF:fr BGD:BD:bn BGR:BG:bg BHR:BH:ar BHS:BS:en BIH:BA:bs ' +
  'BLM:BL:fr BLR:BY:be BLZ:BZ:en BMU:BM:en BOL:BO:es BRA:BR:pt BRB:BB:en BRI:BR:pt BRN:BN:ms ' +
  'BTN:BT:dz BWA:BW:en CAF:CF:fr CAN:CA:en CHE:CH:de CHL:CL:es CHN:CN:zh-CN CIV:CI:fr CLP:FR:fr ' +
  'CMR:CM:fr COD:CD:fr COG:CG:fr COK:CK:en COL:CO:es COM:KM:fr CPV:CV:pt CRI:CR:es CSI:AU:en ' +
  'CUB:CU:es CUW:CW:nl CYM:KY:en CYP:CY:el CZE:CZ:cs DEU:DE:de DJI:DJ:fr DMA:DM:en DNK:DK:da ' +
  'DOM:DO:es DZA:DZ:ar ECU:EC:es EGY:EG:ar ERI:ER:ti ESP:ES:es EST:EE:et ETH:ET:am FIN:FI:fi ' +
  'FJI:FJ:en FLK:FK:en FRA:FR:fr FRO:FO:fo FSM:FM:en GAB:GA:fr GBR:GB:en GEO:GE:ka GGY:GG:en ' +
  'GHA:GH:en GIB:GI:en GIN:GN:fr GMB:GM:en GNB:GW:pt GNQ:GQ:es GRC:GR:el GRD:GD:en GRL:GL:da ' +
  'GTM:GT:es GUM:GU:en GUY:GY:en HKG:HK:zh-HK HMD:HM:en HND:HN:es HRV:HR:hr HTI:HT:fr HUN:HU:hu ' +
  'IDN:ID:id IMN:IM:en IND:IN:hi IOA:AU:en IOT:IO:en IRL:IE:en IRN:IR:fa IRQ:IQ:ar ISL:IS:is ' +
  'ISR:IL:he ITA:IT:it JAM:JM:en JEY:JE:en JOR:JO:ar JPN:JP:ja KAZ:KZ:ru KEN:KE:en KGZ:KG:ru ' +
  'KHM:KH:km KIR:KI:en KNA:KN:en KOR:KR:ko KOS:XK:sq KWT:KW:ar LAO:LA:lo LBN:LB:ar LBR:LR:en ' +
  'LBY:LY:ar LCA:LC:en LIE:LI:de LKA:LK:si LSO:LS:en LTU:LT:lt LUX:LU:fr LVA:LV:lv MAC:MO:zh-HK ' +
  'MAF:MF:fr MAR:MA:ar MCO:MC:fr MDA:MD:ro MDG:MG:fr MDV:MV:en MEX:MX:es MHL:MH:en MKD:MK:mk ' +
  'MLI:ML:fr MLT:MT:mt MMR:MM:my MNE:ME:sr MNG:MN:mn MNP:MP:en MOZ:MZ:pt MRT:MR:ar MSR:MS:en ' +
  'MUS:MU:en MWI:MW:en MYS:MY:ms NAM:NA:en NCL:NC:fr NER:NE:fr NFK:NF:en NGA:NG:en NIC:NI:es ' +
  'NIU:NU:en NLD:NL:nl NOR:NO:no NPL:NP:ne NRU:NR:en NZL:NZ:en OMN:OM:ar PAK:PK:ur PAN:PA:es ' +
  'PCN:PN:en PER:PE:es PHL:PH:en PLW:PW:en PNG:PG:en POL:PL:pl PRI:PR:es PRK:KP:ko PRT:PT:pt ' +
  'PRY:PY:es PYF:PF:fr QAT:QA:ar ROU:RO:ro RUS:RU:ru RWA:RW:en SAH:EH:ar SAU:SA:ar SDN:SD:ar ' +
  'SDS:SS:en SEN:SN:fr SGP:SG:en SGS:GS:en SHN:SH:en SLB:SB:en SLE:SL:en SLV:SV:es SMR:SM:it ' +
  'SOM:SO:so SPM:PM:fr SRB:RS:sr STP:ST:pt SUR:SR:nl SVK:SK:sk SVN:SI:sl SWE:SE:sv SWZ:SZ:en ' +
  'SXM:SX:nl SYC:SC:en SYR:SY:ar TCA:TC:en TCD:TD:fr TGO:TG:fr THA:TH:th TJK:TJ:tg TKM:TM:tk ' +
  'TLS:TL:pt TON:TO:en TTO:TT:en TUN:TN:ar TUR:TR:tr TUV:TV:en TWN:TW:zh-TW TZA:TZ:sw UGA:UG:en ' +
  'UKR:UA:uk UMI:UM:en URY:UY:es USA:US:en UZB:UZ:uz VAT:VA:it VCT:VC:en VEN:VE:es VGB:VG:en ' +
  'VIR:VI:en VNM:VN:vi VUT:VU:en WLF:WF:fr WSM:WS:en YEM:YE:ar ZAF:ZA:en ZMB:ZM:en ZWE:ZW:en';

export const COUNTRY_PLACES: Readonly<Record<string, { region: string; language: string }>> =
  Object.fromEntries(
    TABLE.split(' ').map((entry) => {
      const [adm0, region, language] = entry.split(':') as [string, string, string];
      return [adm0, { region, language }];
    }),
  );

/** The trip's countries as region codes, at most 15 (Google's limit), known ones only. */
export const regionsFor = (adm0s: readonly string[]): string[] =>
  [...new Set(adm0s.map((a) => COUNTRY_PLACES[a]?.region).filter((r): r is string => !!r))].slice(
    0,
    15,
  );

/** The driver's language for the hotel's country; English when unknown. */
export const localLanguageFor = (adm0: string): string => COUNTRY_PLACES[adm0]?.language ?? 'en';
