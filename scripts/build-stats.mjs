// 전적 사이트 저장소에 넣는 파일입니다. data.json 을 읽어 봇이 쓸 stats.json(미리 계산한 요약)을 만듭니다.
//
//   node scripts/build-stats.mjs data.json stats.json
//
// 계산 방식은 사이트 index.html 과 봇(src/stats.ts)의 buildSnapshot 과 똑같습니다.
// 한쪽을 고치면 다른 쪽도 같이 고쳐야 합니다.
import { readFile, writeFile } from "node:fs/promises";

const SNAPSHOT_VERSION = 1;
const DAK_BASE = "https://dak.gg/er/players/";
const OLD_NAME_FIX = { 에바: "이바", 리앙: "이안", 쉬엔린: "슈린", 쉬우카이: "쇼우" };
const fixChar = (name) => OLD_NAME_FIX[name] ?? name;
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function safeUrl(value) {
  const text = String(value ?? "").trim();
  return /^https?:\/\//i.test(text) ? text : "";
}

export function buildSnapshot(raw) {
  const matches = Array.isArray(raw) ? raw : Array.isArray(raw.matches) ? raw.matches : [];
  const aliases = Array.isArray(raw) ? {} : (raw.playerAliases ?? {});
  const profiles = Array.isArray(raw) ? {} : (raw.playerProfiles ?? {});
  const display = (nick) => aliases[nick] || nick;

  const acc = new Map();
  let team1Wins = 0;
  let team2Wins = 0;
  let otherResults = 0;
  const dates = [];

  matches.forEach((match, idx) => {
    const winner = String(match.winner ?? "");
    if (winner === "1") team1Wins++;
    else if (winner === "2") team2Wins++;
    else otherResults++;
    if (match.date) dates.push(match.date);

    for (const team of [1, 2]) {
      const players = (team === 1 ? match.team1Players : match.team2Players) ?? [];
      const chars = ((team === 1 ? match.team1Chars : match.team2Chars) ?? []).map(fixChar);

      players.forEach((nick, i) => {
        const name = display(nick);
        let entry = acc.get(name);
        if (!entry) {
          entry = { games: 0, wins: 0, losses: 0, nicks: new Map(), chars: new Map(), recent: [] };
          acc.set(name, entry);
        }

        const date = match.date ?? "";
        const key = `${date}#${String(idx).padStart(6, "0")}`;
        const previous = entry.nicks.get(nick);
        if (previous === undefined || key >= previous) entry.nicks.set(nick, key);

        const result = winner === "draw" ? "D" : winner === String(team) ? "W" : "L";
        entry.games++;
        if (result === "W") entry.wins++;
        else if (result === "L") entry.losses++;

        const char = match.individualMappingKnown !== false ? (chars[i] ?? null) : null;
        if (char) {
          const usage = entry.chars.get(char) ?? { picks: 0, wins: 0 };
          usage.picks++;
          if (result === "W") usage.wins++;
          entry.chars.set(char, usage);
        }
        entry.recent.push({ date, idx, result, char });
      });
    }
  });

  const players = [...acc.entries()].map(([name, entry]) => {
    const nicks = [...entry.nicks.entries()]
      .sort((a, b) => (b[1] < a[1] ? -1 : b[1] > a[1] ? 1 : 0))
      .map(([nick]) => nick);
    const latest = nicks[0] ?? name;

    const auto = [...entry.chars.entries()]
      .sort((a, b) => b[1].picks - a[1].picks || b[1].wins - a[1].wins || byName(a[0], b[0]))
      .slice(0, 3)
      .map(([charName]) => charName);

    const profile = profiles[name] ?? {};
    const manual = (Array.isArray(profile.most3) ? profile.most3 : [])
      .filter((c) => typeof c === "string" && c !== "")
      .slice(0, 3);

    const dakNick = String(profile.dakNick ?? "").trim();
    const dakUrl = safeUrl(profile.dakUrl) || DAK_BASE + encodeURIComponent(dakNick || latest);

    const recent = entry.recent
      .slice()
      .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : b.idx - a.idx))
      .slice(0, 5)
      .map(({ date, result, char }) => ({ date, result, char }));

    return {
      name,
      games: entry.games,
      wins: entry.wins,
      losses: entry.losses,
      rate: entry.games ? entry.wins / entry.games : 0,
      nicks,
      most3: manual.length ? manual : auto,
      mostIsManual: manual.length > 0,
      dakUrl,
      recent,
    };
  });

  players.sort((a, b) => b.games - a.games || byName(a.name, b.name));
  dates.sort();

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    matchCount: matches.length,
    firstDate: dates[0] ?? "",
    lastDate: dates[dates.length - 1] ?? "",
    team1Wins,
    team2Wins,
    otherResults,
    players,
  };
}

// 명령줄로 실행했을 때만 파일을 읽고 씁니다. (테스트에서 import 해서 buildSnapshot 만 쓸 수 있게)
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href;
if (isMain) {
  const [input = "data.json", output = "stats.json"] = process.argv.slice(2);
  const raw = JSON.parse(await readFile(input, "utf8"));

  const hasMatches = Array.isArray(raw) || Array.isArray(raw.matches);
  if (!hasMatches) {
    console.error(`${input} 에서 경기 목록(matches)을 찾지 못했습니다. stats.json 을 만들지 않습니다.`);
    process.exit(1);
  }

  const snapshot = buildSnapshot(raw);
  await writeFile(output, JSON.stringify(snapshot) + "\n", "utf8");
  console.log(`${output} 생성 완료: ${snapshot.matchCount}경기, 플레이어 ${snapshot.players.length}명`);
}
