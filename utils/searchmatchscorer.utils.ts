/*
 * MIT License
 *
 * Copyright (c) 2015 Rishi Ghan
 *
 The MIT License (MIT)

Copyright (c) 2015 Rishi Ghan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

/*
 * Revision History:
 *     Initial:        2021/07/29        Rishi Ghan
 */

import { createWriteStream } from "fs";
import path from "path";
import https from "https";
import stringSimilarity from "string-similarity";
import { isNil, map, isUndefined } from "lodash";
import leven from "leven";
import { isAfter, isSameYear, parseISO } from "date-fns";

const imghash = require("imghash");

export const matchScorer = async (
	searchMatches: Promise<any>[],
	searchQuery: any,
	rawFileDetails: any
): Promise<any> => {
	const scoredMatches: any = [];

	try {
		const matches = await Promise.all(searchMatches);

		for (const match of matches) {
			match.score = 0;

			// Check for the issue name match
			if (!isNil(searchQuery.name) && !isNil(match.name)) {
				const issueNameScore = stringSimilarity.compareTwoStrings(
					searchQuery.name,
					match.name
				);
				match.score = issueNameScore;
			}

			// Issue number matches
			if (!isNil(searchQuery.number) && !isNil(match.issue_number)) {
				if (
					parseInt(searchQuery.number, 10) ===
					parseInt(match.issue_number, 10)
				) {
					match.score += 1;
				}
			}

			// Cover image hash match
			scoredMatches.push(
				await calculateLevenshteinDistance(match, rawFileDetails)
			);
		}

		return scoredMatches;
	} catch (error) {
		// Handle errors here
		console.error("Error in matchScorer:", error);
		throw error;
	}
};

export const rankVolumes = (volumes: any, scorerConfiguration: any) => {
	// Iterate over volumes, checking to see:
	// 1. If the detected year of the issue falls in the range (end_year >= {detected year for issue} >= start_year )
	// 2. If there is a strong string comparison between the volume name and the issue  name ??
	const issueNumber = parseInt(scorerConfiguration.searchParams.number, 10);
	const issueYear = parseISO(scorerConfiguration.searchParams.year);
	const foo = volumes.map((volume: any, idx: number) => {
		let volumeMatchScore = 0;
		const volumeStartYear = !isNil(volume.start_year)
			? parseISO(volume.start_year)
			: null;
		const firstIssueNumber = !isNil(volume.first_issue)
			? parseInt(volume.first_issue.issue_number, 10)
			: null;
		const lastIssueNumber = !isNil(volume.last_issue)
			? parseInt(volume.last_issue.issue_number, 10)
			: null;
		let issueNameMatchScore = stringSimilarity.compareTwoStrings(
			scorerConfiguration.searchParams.name,
			volume.name
		);
		// 1. If there is a subtitle in the candidate volume's name, add it to the issueNameMatchScore
		// If not, move on.
		let subtitleMatchScore = 0;
		if (!isNil(scorerConfiguration.searchParams.subtitle)) {
			subtitleMatchScore = stringSimilarity.compareTwoStrings(
				scorerConfiguration.searchParams.subtitle,
				volume.name
			);
			if (subtitleMatchScore > 0.1) {
				issueNameMatchScore += subtitleMatchScore;
			}
		}
		// 2. If issue year starts after the candidate volume's start year or is the same year, +2 to volumeMatchScore
		if (!isNil(volumeStartYear)) {
			if (
				isSameYear(issueYear, volumeStartYear) ||
				isAfter(issueYear, volumeStartYear)
			) {
				volumeMatchScore += 2;
			}
		}
		// 3. If issue number falls in the range of candidate volume's first issue # and last issue #, +3 to volumeMatchScore
		if (!isNil(firstIssueNumber) && !isNil(lastIssueNumber)) {
			if (
				firstIssueNumber <= issueNumber ||
				issueNumber <= lastIssueNumber
			) {
				volumeMatchScore += 3;
			}
		}
		if (issueNameMatchScore > 0.5 && volumeMatchScore > 2) {
			console.log(`Found a match for criteria, volume ID: ${volume.id}`);
			return volume.id;
		}
	});
	return foo.filter((item: any) => !isNil(item));
};

const calculateLevenshteinDistance = async (match: any, rawFileDetails: any) =>
	new Promise((resolve, reject) => {
		https.get(match.image.small_url, (response: any) => {
			console.log(rawFileDetails.cover.filePath);
			const fileName = match.id + "_" + rawFileDetails.name + ".jpg";
			const file = createWriteStream(
				`${process.env.USERDATA_DIRECTORY}/temporary/${fileName}`
			);
			const fileStream = response.pipe(file);
			fileStream.on("finish", async () => {
				// 1. hash of the cover image we have on hand
				const coverFileName = rawFileDetails.cover.filePath
					.split("/")
					.at(-1);
				const coverDirectory = rawFileDetails.containedIn
					.split("/")
					.at(-1);
				const hash1 = await imghash.hash(
					path.resolve(
						`${process.env.USERDATA_DIRECTORY}/covers/${coverDirectory}/${coverFileName}`
					)
				);
				// 2. hash of the cover of the potential match
				const hash2 = await imghash.hash(
					path.resolve(
						`${process.env.USERDATA_DIRECTORY}/temporary/${fileName}`
					)
				);
				if (!isUndefined(hash1) && !isUndefined(hash2)) {
					const levenshteinDistance = leven(hash1, hash2);
					if (levenshteinDistance === 0) {
						match.score += 2;
					} else if (
						levenshteinDistance > 0 &&
						levenshteinDistance <= 2
					) {
						match.score += 1;
					} else {
						match.score -= 2;
					}
					resolve(match);
				} else {
					reject({ error: "Couldn't calculate hashes." });
				}
			});
		});
	});
