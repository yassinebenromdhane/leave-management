// Spec 2.5: a password is rejected if it appears on a common-password list.
// Bundled subset of the most frequent leaked passwords that also satisfy the 8-character
// minimum (shorter ones are already rejected by length). Comparison is case-insensitive.
// To strengthen it, replace this list with a larger file (e.g. the top 10k) behind the same function.

const LIST = `
12345678 123456789 1234567890 12345678910 11111111 00000000 88888888 87654321 11223344
password password1 password12 password123 password! passw0rd p@ssword p@ssw0rd motdepasse
motdepasse1 azertyuiop azerty123 azerty1234 qwertyuiop qwerty123 qwerty1234 qwertyui
1q2w3e4r 1q2w3e4r5t 1qaz2wsx zaq12wsx q1w2e3r4 a1b2c3d4 abcd1234 abc12345 abcdefgh
iloveyou iloveyou1 jetaime jetaime1 sunshine princess football baseball superman
batman123 starwars welcome1 welcome123 bienvenue bienvenue1 letmein1 trustno1 whatever
dragon123 monkey123 master123 shadow123 michael1 jennifer charlie1 computer internet
1234qwer qwer1234 asdfghjk asdfasdf zxcvbnm1 zxcvbnmm changeme changeme1 default1
administrator admin123 admin1234 adminadmin root1234 test1234 testtest test12345
soleil123 doudou123 chocolat marseille nicolas1 camille1 vacances1 bonjour1 bonjour123
liverpool chelsea1 arsenal1 barcelona realmadrid juventus michelle mustang1 freedom1
123123123 147258369 159753456 789456123 741852963 123qweasd qweasdzxc 1q2w3e4r5t6y
summer2024 summer2025 summer2026 winter2025 winter2026 spring2026 autumn2026
janvier2026 novembre2026 decembre2026 company123 entreprise conges2026 leave2026
`;

const COMMON = new Set(
  LIST.split(/\s+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean),
);

export function isCommonPassword(password: string): boolean {
  return COMMON.has(password.trim().toLowerCase());
}
