/* Đổi sang tên index.ts khi sử dụng*/
import puppeteer, { Browser, Page } from "puppeteer";
import { fileURLToPath } from "url";
import * as fsp from "node:fs/promises";
import fs from "fs";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BaseURL = "https://truyenwikidich.net";
const url =
  "https://truyenwikidich.net/tim-kiem?qs=1&gender=5794f03dd7ced228f4419198&m=3&so=4&y=2025&vo=1#";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const saveData = async (data: any[], outputFile: string) => {
  await fsp.writeFile(outputFile, JSON.stringify(data, null, 2), "utf-8");
};

const saveAppendData = async (data: any[], outputFile: string) => {
  await fsp.appendFile(outputFile, JSON.stringify(data, null, 2), "utf-8");
};

/**
 * Chuyển sang trang tiếp theo nếu có.
 */
const nextPage = async (page: Page, selector: string, currentPage: number) => {
  const pageButtons = await page.$$(selector);

  for (const button of pageButtons) {
    const pageNumber = await page.evaluate(
      (el) => parseInt((el as HTMLElement).innerText.trim(), 10),
      button
    );

    if (!isNaN(pageNumber) && pageNumber > currentPage) {
      console.log(`🔄 Chuyển sang trang ${pageNumber}...`);
      await button.click();
      await sleep(2000);
      return pageNumber;
    }
  }

  console.log("✅ Không còn trang tiếp theo.");
  return null;
};

/**
 * Lấy danh sách truyện từ trang tìm kiếm.
 */
const getTruyenList = async () => {
  console.log("🚀 Bắt đầu Puppeteer...");

  const browser: Browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url);

  let currentPage = 1;

  while (true) {
    console.log(`📄 Đang scrape trang ${currentPage}...`);

    await page.waitForSelector(".book-item", { visible: true });

    const truyenData = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".book-item")).map((truyen: any) => ({
        title: truyen.querySelector(".book-title")?.innerText.trim() || "Không có tiêu đề",
        author: truyen.querySelector(".book-author a.truncate")?.innerText.trim() || "Không có tác giả",
        cover: truyen.querySelector(".cover-col a.cover-wrapper img")?.src || "Không có ảnh",
        gender: truyen.querySelector(".book-gender")?.innerText.trim() || "Không có thể loại chính",
        status: truyen.querySelectorAll(".book-publisher a.truncate")?.[1]?.innerText.trim() || "Không có thể loại chính",
        source: truyen.querySelector(".tooltipped")?.getAttribute("href") || "Không có source",
      }));
    });

    await saveData(truyenData, "truyen-data.json");

    const nextPageNumber = await nextPage(page, "li.waves-effect a", currentPage);
    if (nextPageNumber === null) break;
    currentPage = nextPageNumber;
  }

  console.log("💾 Lưu danh sách truyện vào truyen-data.json");
  await browser.close();
};

/**
 * Lấy danh sách tất cả chapter của một truyện.
 */
const getAllChapters = async (page: Page) => {
  let allChapters = [];
  let currentPage = 1;

  while (true) {
    console.log(`📖 Lấy chương từ trang ${currentPage}...`);

    try {
      await page.waitForSelector("li.chapter-name a.truncate", { timeout: 30000 });
    } catch {
      console.warn(`⚠ Không tìm thấy danh sách chương trên trang ${currentPage}, bỏ qua...`);
      break;
    }

    const chapters = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("li.chapter-name a.truncate")).map((a ) => ({
        title: (a as HTMLElement).innerText.trim(),
        link: (a as HTMLElement).getAttribute('href')
      }));
    });

    allChapters = allChapters.concat(chapters);

    const newPage = await nextPage(page, 'li.waves-effect a[data-action="loadBookIndex"]', currentPage);
    if (newPage === null) break;
    currentPage = newPage;
  }

  return allChapters;
};

/**
 * Lưu thông tin chi tiết của một truyện và danh sách chapter.
 */
const chapterList = async (truyenUrl: string, filename: string) => {
  const browser: Browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(truyenUrl, { waitUntil: "domcontentloaded" });

    const isLocked = await page.evaluate(() => {
      return document.querySelector("#formVerifyCode") || document.querySelector("#modalManagerPermission");
    });

    if (isLocked) {
      console.warn(`⚠ Truyện tại ${truyenUrl} yêu cầu xác minh hoặc bị khóa, bỏ qua...`);
      return;
    }

    await page.waitForSelector(".cover-info", { timeout: 10000 });

    const storyInfo = await page.evaluate(() => {
        const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerText.trim() : null;};
      const getGenres = () => Array.from(document.querySelectorAll(".book-desc span a")).map(a => (a as HTMLElement).innerText.trim());

      return {
        title: getText(".cover-info h2"),
        views: getText(".book-stats:nth-of-type(1) span"),
        stars: getText(".book-stats:nth-of-type(2) span"),
        comments: getText(".book-stats:nth-of-type(3) span"),
        hanViet: getText(".cover-info p:nth-of-type(2) a"),
        author: getText(".cover-info p:nth-of-type(3) a"),
        status: getText(".cover-info p:nth-of-type(4) a"),
        latestChapter: getText(".cover-info p:nth-of-type(5) a"),
        lastUpdate: getText(".cover-info p:nth-of-type(6) span"),
        thanks: getText(".cover-info p:nth-of-type(7) span"),
        genres: getGenres(),
        description: getText(".book-desc-detail"),
        chapters: [],
      };
    });

    storyInfo.chapters = await getAllChapters(page);
    await saveData([storyInfo], filename);
    console.log(`💾 Lưu thông tin truyện vào ${filename}`);

  } catch (error) {
    console.error(`❌ Lỗi khi lấy truyện ${truyenUrl}: ${(error as Error).message}`);
  } finally {
    await browser.close();
  }
};

/**
 * Hàm chính để lấy toàn bộ danh sách truyện và chapter.
 */
const saveChapters = async (listTruyenURL: string) => {
  const rawData = await fs.promises.readFile(listTruyenURL, "utf-8");
  const jsonData = JSON.parse(rawData);

  for (const [index, truyen] of jsonData.entries()) {
    const filename = `${truyen.title.replace(/\s+/g, "_")}.json`;
    console.log(`📖 Lưu chương cho truyện: ${truyen.title}`);
    await chapterList(BaseURL + truyen.source, path.join(__dirname, "truyen-data", filename));
  }
};

// Chạy chức năng chính
// getTruyenList();
saveChapters("truyen-data.json");
