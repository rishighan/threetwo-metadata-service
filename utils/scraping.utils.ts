import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { faker } from "@faker-js/faker";
import axios from "axios";
import { JSDOM } from "jsdom";

// Optional Tor
const useTor = process.env.USE_TOR === "true";
const torProxy = process.env.TOR_SOCKS_PROXY || "socks5://192.168.1.119:9050";

// Apply stealth plugin
puppeteer.use(StealthPlugin());

export const getWeeklyPullList = async (url: string) => {
	const browser = await puppeteer.launch({
		headless: true,
		slowMo: 50,
		args: useTor
			? [`--proxy-server=${torProxy}`]
			: ["--no-sandbox", "--disable-setuid-sandbox"],
	});

	const page = await browser.newPage();

	await page.setExtraHTTPHeaders({
		"Accept-Language": "en-US,en;q=0.9",
		"Referer": "https://leagueofcomicgeeks.com/",
	});

	await page.setUserAgent(faker.internet.userAgent());

	await page.setViewport({
		width: faker.number.int({ min: 1024, max: 1920 }),
		height: faker.number.int({ min: 768, max: 1080 }),
	});

	try {
		await page.goto(url, {
			waitUntil: "domcontentloaded", // faster and more reliable for JS-rendered content
			timeout: 30000, // give it time on Tor or slow networks
		});

		await page.waitForSelector(".issue", { timeout: 30000 });
		console.log("✅ Found .issue blocks");

		return await page.evaluate(() => {
			const issues = Array.from(document.querySelectorAll(".issue"));

			return issues.map(issue => {
				const issueUrlElement = issue.querySelector(".cover a");
				const coverImageElement =
					issue.querySelector(".cover img.lazy");
				const publisherText =
					issue.querySelector("div.publisher")?.textContent?.trim() ||
					null;
				const issueName =
					issue
						.querySelector("div.title")
						?.getAttribute("data-sorting") || null;

				// Convert Unix timestamp (in seconds) to YYYY-MM-DD
				const publicationDateRaw = issue
					.querySelector(".date")
					?.getAttribute("data-date");
				const publicationDate = publicationDateRaw
					? new Date(parseInt(publicationDateRaw, 10) * 1000)
							.toISOString()
							.split("T")[0]
					: null;

				const imageUrl =
					coverImageElement?.getAttribute("data-src") ||
					coverImageElement?.getAttribute("src") ||
					null;

				const coverImageUrl = imageUrl
					? imageUrl.replace(/\/medium-(\d+\.jpg)/, "/large-$1")
					: null;

				const issueUrl = issueUrlElement?.getAttribute("href") || null;

				return {
					issueName,
					coverImageUrl,
					issueUrl,
					publisher: publisherText,
					publicationDate,
				};
			});
		});
	} catch (err) {
		console.error("❌ Scraper error:", err);
		throw err;
	} finally {
		await browser.close();
	}
};

// export const scrapeIssuesFromSeriesPage = async (url: string) => {
// 	const response = await axios(url);
// 	const dom = new JSDOM(response.data, {
// 		url,
// 		referrer: url,
// 		contentType: "text/html",
// 		includeNodeLocations: true,
// 		storageQuota: 10000000,
// 	});
// 	const seriesId = dom.window.document
// 		.querySelector("#comic-list-block")
// 		.getAttribute("data-series-id");
// 	const issueNodes = dom.window.document.querySelectorAll(
// 		"ul.comic-list-thumbs > li"
// 	);

// 	const issues: any = [];
// 	issueNodes.forEach(node => {
// 		const comicHref = node.querySelector("a").getAttribute("href");
// 		const issueCoverImage = node.querySelector("img").getAttribute("src");
// 		const issueDetails = node.querySelector("img").getAttribute("alt");
//         const issueDate = node.querySelector("span.date").getAttribute("data-date");
//         const formattedIssueDate = node.querySelector("span.date").textContent.trim();
//         const publisher = node.querySelector("div.publisher").textContent.trim();

// 		issues.push({
// 			comicHref,
// 			issueCoverImage,
// 			issueDetails,
//             issueDate,
//             formattedIssueDate,
//             publisher,
// 		});
// 	});
// 	return {
// 		seriesId,
// 		issues,
// 	};
// };

export const scrapeIssuePage = async (url: string) => {
	const response = await axios(url);
	const dom = new JSDOM(response.data, {
		url,
		referrer: url,
		contentType: "text/html",
		includeNodeLocations: true,
		storageQuota: 10000000,
	});
	const seriesDOMElement = dom.window.document
		.querySelector("div.series-pagination > a.series")
		.getAttribute("href");
	return seriesDOMElement;
};
