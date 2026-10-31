export function parseSeriesDate(
    date: string | null | undefined,
): string | null {
    if (!date) return null;

    const now = new Date();

    const toMidNight = (d: Date) => {
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
    };

    const startsWith = (s: string, words: string[]) =>
        words.some((w) => s.toLowerCase().startsWith(w.toLowerCase()));

    const endsWith = (s: string, words: string[]) =>
        words.some((w) => s.toLowerCase().endsWith(w.toLowerCase()));

    // Handle keywords like "yesterday", "today"
    if (startsWith(date, ["yesterday", "يوم واحد"])) {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return toMidNight(d);
    }

    if (startsWith(date, ["today"])) {
        return toMidNight(new Date(now));
    }

    if (startsWith(date, ["يومين"])) {
        const d = new Date(now);
        d.setDate(d.getDate() - 2);
        return toMidNight(d);
    }

    // Handle relative formats
    if (
        endsWith(date, ["ago", "atrás", "önce", "قبل"]) ||
        startsWith(date, ["hace"]) ||
        /\b\d+ jour/.test(date) ||
        /^(\d+)([smhdwMy])\s*ago$/.test(date)
    ) {
        return parseRelativeDate(date);
    }

    // Convert date like "5th December 2022" -> "5 December 2022"
    if (/\d(st|nd|rd|th)/.test(date)) {
        const cleaned = date
            .split(" ")
            .map((part) =>
                /\d\D{2}/.test(part) ? part.replace(/\D/g, "") : part,
            )
            .join(" ");
        return tryParseDate(cleaned);
    }

    // Fallback: try parsing regular date
    return tryParseDate(date);
}

export function parseRelativeDate(date: string): string | null {
    const now = new Date();

    // Short-form like "5d ago"
    const shortRegex = /^(\d+)([smhdwMy])\s*ago$/;
    const shortMatch = date.match(shortRegex);
    if (shortMatch?.[1]) {
        const value = Number.parseInt(shortMatch[1], 10);
        const unit = shortMatch[2];

        const d = new Date(now);
        switch (unit) {
            case "s":
                d.setSeconds(d.getSeconds() - value);
                break;
            case "m":
                d.setMinutes(d.getMinutes() - value);
                break;
            case "h":
                d.setHours(d.getHours() - value);
                break;
            case "d":
                d.setDate(d.getDate() - value);
                break;
            case "w":
                d.setDate(d.getDate() - value * 7);
                break;
            case "M":
                d.setMonth(d.getMonth() - value);
                break;
            case "y":
                d.setFullYear(d.getFullYear() - value);
                break;
            default:
                return null;
        }
        return d.toISOString();
    }

    // Long-form: "5 days ago", "2 horas atrás", etc.
    const numberMatch = date.match(/(\d+)/);
    const number = numberMatch ? Number.parseInt(numberMatch[0]) : null;
    if (!number) return null;

    const units = [
        {
            words: [
                "hari",
                "gün",
                "jour",
                "día",
                "dia",
                "day",
                "วัน",
                "ngày",
                "giorni",
                "أيام",
                "天",
            ],
            adjust: (d: Date) => d.setDate(d.getDate() - number),
        },
        {
            words: [
                "jam",
                "saat",
                "heure",
                "hora",
                "hour",
                "ชั่วโมง",
                "giờ",
                "ore",
                "ساعة",
                "小时",
            ],
            adjust: (d: Date) => d.setHours(d.getHours() - number),
        },
        {
            words: [
                "menit",
                "dakika",
                "min",
                "minute",
                "minuto",
                "นาที",
                "دقائق",
            ],
            adjust: (d: Date) => d.setMinutes(d.getMinutes() - number),
        },
        {
            words: ["detik", "segundo", "second", "วินาที"],
            adjust: (d: Date) => d.setSeconds(d.getSeconds() - number),
        },
        {
            words: ["week", "semana"],
            adjust: (d: Date) => d.setDate(d.getDate() - number * 7),
        },
        {
            words: ["month", "mes"],
            adjust: (d: Date) => d.setMonth(d.getMonth() - number),
        },
        {
            words: ["year", "año"],
            adjust: (d: Date) => d.setFullYear(d.getFullYear() - number),
        },
    ];

    for (const unit of units) {
        if (unit.words.some((w) => date.toLowerCase().includes(w))) {
            const d = new Date(now);
            unit.adjust(d);
            return d.toISOString();
        }
    }

    return null;
}

export function tryParseDate(dateString: string): string | null {
    const parsed = Date.parse(dateString);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
