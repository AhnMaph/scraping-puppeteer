import puppeteer, { Page, Browser } from 'puppeteer';
import randomUseragent from 'random-useragent';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import puppeteerExtraImport from 'puppeteer-extra';
import { fileURLToPath } from 'url';
import * as fs from 'node:fs/promises';
import path from 'path';
const puppeteerExtra = puppeteerExtraImport as any;
puppeteerExtra.use(StealthPlugin());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://truyenwikidich.net';
const SEARCH_URL = `${BASE_URL}/tim-kiem?qs=1&gender=5794f03dd7ced228f4419195&tc=4&tf=0&m=4&y=2025&q=`;
const OUTPUT_DIR = path.join(__dirname, 'truyen');
const MAX_CONCURRENT_TABS = 5;

const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms + Math.random() * 800));

const saveData = async (data: any, filePath: string): Promise<void> => {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

const getNextPage = async (page, selector: string, currentPage: number): Promise<number | null> => {
    const buttons = await page.$$(selector);
    for (const button of buttons) {
        const pageNum = await page.evaluate(el => parseInt(el.textContent?.trim() || 'NaN', 10), button);
        if (!isNaN(pageNum) && pageNum > currentPage) {
            console.log(`➡️ Chuyển sang trang ${pageNum}...`);
            await button.click();
            return pageNum;
        }
    }
    console.log("⛔ Không còn trang tiếp theo.");
    return null;
};

const scrapeTruyen = async (): Promise<void> => {
    console.log("🚀 Bắt đầu scrape danh sách truyện...");
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        let currentPage = 1;
        let page = await browser.newPage();
        const ua = randomUseragent.getRandom();
        await page.setUserAgent(ua); 
        await page.goto(SEARCH_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });

        while (true) {
            console.log(`📄 Đang scrape trang ${currentPage}...`);
            await page.waitForSelector('.book-item', { timeout: 60000 });
            await sleep(1500);

            const truyenData = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.book-item')).map((truyen: any) => ({
                    cover: truyen.querySelector('.cover-col a.cover-wrapper img')?.getAttribute('src') || "",
                    source: truyen.querySelector('.tooltipped')?.getAttribute('href') || ""
                }));
            });

            console.log(`✅ Tìm thấy ${truyenData.length} truyện trên trang này.`);
            await fs.mkdir(OUTPUT_DIR, { recursive: true });

            for (const [index, truyen] of truyenData.entries()) {
                const truyenUrl = `${BASE_URL}${truyen.source}`;
                const filepath = path.join(OUTPUT_DIR, `truyen_${(currentPage - 1) * 26 + index + 1}.json`);
                console.log(`🔗 URL truyện: ${truyenUrl}`);

                const detail = await getTruyenDescription(browser, truyenUrl);
                if (detail) {
                    detail.covers = truyen.cover;
                    detail.chapters = await getChaptersFromList(browser, detail.chapters, []);
                    await saveData(detail, filepath);
                }
                await sleep(1000);
            }

            const nextPageNum = await getNextPage(page, 'li.waves-effect a', currentPage);
            if (!nextPageNum) break;

            currentPage = nextPageNum;
            await page.close();
            page = await browser.newPage();
            await page.goto(SEARCH_URL);
        }
    } catch (error: any) {
        console.error(`❌ Lỗi scrape danh sách: ${error.message}`);
    } finally {
        await browser.close();
        console.log("🏁 Hoàn tất scrape danh sách truyện.");
    }
};

const getTruyenDescription = async (browser, url: string): Promise<any> => {
    const page = await browser.newPage();
    const ua = randomUseragent.getRandom();
    await page.setUserAgent(ua); 
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const isLocked = await page.evaluate(() => !!document.querySelector('#formVerifyCode, #modalManagerPermission'));
        if (isLocked) {
            console.warn(`🔒 Truyện tại ${url} bị khóa`);
            return null;
        }

        await page.waitForSelector('.cover-info');
        await page.waitForSelector('.book-desc-detail');

        return await page.evaluate(() => ({
            title: document.querySelector('.cover-info h2')?.textContent?.trim() || "",
            views: document.querySelector('.book-stats:nth-of-type(1) span')?.textContent?.trim() || "",
            stars: document.querySelector('.book-stats:nth-of-type(2) span')?.textContent?.trim() || "",
            comments: document.querySelector('.book-stats:nth-of-type(3) span')?.textContent?.trim() || "",
            hanViet: document.querySelector('.cover-info p:nth-of-type(2) a')?.textContent?.trim() || "",
            author: document.querySelector('.cover-info p:nth-of-type(3) a')?.textContent?.trim() || "",
            status: document.querySelector('.cover-info p:nth-of-type(4) a')?.textContent?.trim() || "",
            latestChapter: document.querySelector('.cover-info p:nth-of-type(5) a')?.textContent?.trim() || "",
            lastUpdate: document.querySelector('.cover-info p:nth-of-type(6) span')?.textContent?.trim() || "",
            thanks: document.querySelector('.cover-info p:nth-of-type(7) span')?.textContent?.trim() || "",
            genres: Array.from(document.querySelectorAll('.book-desc span a')).map(a => a.textContent?.trim() || ""),
            description: document.querySelector('.book-desc-detail')?.textContent?.trim() || "",
            chapters: Array.from(document.querySelectorAll('li.chapter-name a.truncate'))
                .map(a => ({
                    title: a.textContent?.trim() || "",
                    link: a.getAttribute('href') || ""
                }))
        }));
    } catch (error: any) {
        console.error(`❌ Lỗi chi tiết truyện ${url}: ${error.message}`);
        return null;
    } finally {
        await page.close();
    }
};

const getChapterContent = async (browser, url: string): Promise<any> => {
    const page = await browser.newPage();
    const ua = randomUseragent.getRandom();
    await page.setUserAgent(ua); 
    console.log(`📖 Lấy nội dung chương: ${url}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#bookContent', { timeout: 60000 });

        return await page.evaluate(() => {
            const paragraphs = document.querySelectorAll('#bookContentBody p');
            return {
                title_chapter: document.querySelector('p.book-title:nth-of-type(2)')?.textContent?.trim() || "",
                content: Array.from(paragraphs).map(p => p.textContent?.trim() || "").join('\n')
            };
        });
    } catch (error: any) {
        console.error(`❌ Lỗi nội dung chương ${url}: ${error.message}`);
        return null;
    } finally {
        await page.close();
    }
};

const getChaptersFromList = async (browser, chapters: any[], results: any[]): Promise<any[]> => {
    for (const [index, chapter] of chapters.entries()) {
        try {
            console.log(`📘 Chương ${index + 1}: ${chapter.title}`);
            const content = await getChapterContent(browser, `${BASE_URL}${chapter.link}`);
            if (content) results.push(content);
        } catch (error: any) {
            console.error(`❌ Lỗi chương ${chapter.title}: ${error.message}`);
        }
        await sleep(1000);
    }
    return results;
};

// 🟢 Khởi chạy
scrapeTruyen().catch(error => {
    console.error("❌ Lỗi không xử lý được:", error);
});