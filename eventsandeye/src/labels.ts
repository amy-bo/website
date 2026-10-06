// Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.

/** A session label for use mid-sentence: "Dinner" becomes "dinner", but "Saturday outing" keeps its capital. Shared
 * by the server and the pages' scripts. */
export const lowerLabel = (label: string) =>
	/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(label) || /^[A-Z]{2}/.test(label)
		? label
		: label.charAt(0).toLowerCase() + label.slice(1);
