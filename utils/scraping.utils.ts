import jsdom from "jsdom";
import axios from "axios";
const { JSDOM } = jsdom;

export const scrapeIssuesFromSeriesPage = async (url: string) => {
	const response = await axios(url);
	const dom = new JSDOM(response.data, {
		url,
		referrer: url,
		contentType: "text/html",
		includeNodeLocations: true,
		storageQuota: 10000000,
	});
	const seriesId = dom.window.document
		.querySelector("#comic-list-block")
		.getAttribute("data-series-id");
	const issueNodes = dom.window.document.querySelectorAll(
		"ul.comic-list-thumbs > li"
	);

	const issues: any = [];
	issueNodes.forEach(node => {
		const comicHref = node.querySelector("a").getAttribute("href");
		const issueCoverImage = node.querySelector("img").getAttribute("src");
		const issueDetails = node.querySelector("img").getAttribute("alt");
        const issueDate = node.querySelector("span.date").getAttribute("data-date");
        const formattedIssueDate = node.querySelector("span.date").textContent.trim();
        const publisher = node.querySelector("div.publisher").textContent.trim();

		issues.push({
			comicHref,
			issueCoverImage,
			issueDetails,
            issueDate,
            formattedIssueDate,
            publisher,
		});
	});
	return {
		seriesId,
		issues,
	};
};

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
		.querySelector("div.series-pagination > a.series").getAttribute("href");
    return seriesDOMElement;
};


export const getWeeklyPullList = async () => {
	const url = "https://www.tfaw.com/comics/new-releases.html";
	const response = await axios(url);
	const dom = new JSDOM(response.data, {
		url,
		referrer: url,
		contentType: "text/html",
		includeNodeLocations: true,
		storageQuota: 10000000,
	});

	const pullList: any[] = [];
	// Node for the comics container
	const issueNodes = dom.window.document.querySelectorAll("ol.products > li");

	issueNodes.forEach(node => {
		const coverImageUrl = node.querySelector("img.photo").getAttribute("data-src");
		const name = node.querySelector("div.product > a.product").textContent.trim();
		const publicationDate = node.querySelector("div.product-item-date").textContent.trim();
		pullList.push({
			coverImageUrl,
			name,
			publicationDate,
		});
	});

	return pullList;

};
