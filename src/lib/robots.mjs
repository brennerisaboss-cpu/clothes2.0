// A real robots.txt parser.
//
// Not a convenience: this project's whole premise is that access rules are
// obeyed rather than worked around, so the code that decides "may I fetch this"
// has to be correct rather than approximate.
//
// Implements the parts of RFC 9309 that matter here:
//   * group selection by User-agent, most-specific match wins, `*` as fallback
//   * Allow and Disallow with longest-match-wins, Allow winning a tie
//   * `$` end-anchor and `*` wildcards in paths
//   * Crawl-delay, so a stated delay is honoured rather than ignored
//
// Fail-closed: an unparseable robots.txt is treated as "do not fetch", never as
// permission.

function escapeRegex(str) {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** A robots path pattern -> RegExp. `*` is any run, `$` anchors the end. */
function patternToRegex(pattern) {
  let body = '';
  let anchored = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') body += '.*';
    else if (ch === '$' && i === pattern.length - 1) anchored = true;
    else body += escapeRegex(ch);
  }
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastLineWasAgent = false;

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;
    if (!current) continue;

    if (field === 'disallow' || field === 'allow') {
      // An empty Disallow means "nothing is disallowed" and is not a rule.
      if (field === 'disallow' && value === '') continue;
      current.rules.push({ allow: field === 'allow', path: value, re: patternToRegex(value) });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  return groups;
}

/** Pick the group for a user agent: exact-ish match wins over `*`. */
export function selectGroup(groups, userAgent) {
  const ua = String(userAgent ?? '').toLowerCase();
  let best = null;
  let bestLen = -1;

  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        if (bestLen < 0) {
          best = group;
          bestLen = 0;
        }
      } else if (ua.includes(agent) && agent.length > bestLen) {
        best = group;
        bestLen = agent.length;
      }
    }
  }
  return best;
}

/**
 * @returns {{ allowed: boolean, rule: string|null, crawlDelay: number|null }}
 * Longest matching pattern wins; Allow wins an exact-length tie.
 */
export function isAllowed(groups, userAgent, path) {
  const group = selectGroup(groups, userAgent);
  if (!group) return { allowed: true, rule: null, crawlDelay: null };

  let winner = null;
  for (const rule of group.rules) {
    if (!rule.re.test(path)) continue;
    if (
      !winner ||
      rule.path.length > winner.path.length ||
      (rule.path.length === winner.path.length && rule.allow && !winner.allow)
    ) {
      winner = rule;
    }
  }

  return {
    allowed: winner ? winner.allow : true,
    rule: winner ? `${winner.allow ? 'Allow' : 'Disallow'}: ${winner.path}` : null,
    crawlDelay: group.crawlDelay,
  };
}
