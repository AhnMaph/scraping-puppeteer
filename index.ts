import puppeteer, { Page, Browser } from 'puppeteer';
import { fileURLToPath } from 'url';
import * as fs from 'node:fs/promises';
import axios from 'axios';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://truyenwikidich.net';
const SEARCH_URL = `${BASE_URL}/tim-kiem?qs=1&gender=5794f03dd7ced228f4419198&tc=4&tf=0&m=4&y=2025&q=`;
const OUTPUT_DIR = path.join(__dirname, 'truyen-save');
const MAX_CONCURRENT_TABS = 5;

// Utility functions
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const saveData = async (data: any, filePath: string): Promise<void> => {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

// Pagination handler
const getNextPage = async (page: Page, selector: string, currentPage: number): Promise<number | null> => {
    const buttons = await page.$$(selector);
    for (const button of buttons) {
        const pageNum = await page.evaluate(el => parseInt((el as HTMLElement).innerText.trim(), 10), button);
        if (!isNaN(pageNum) && pageNum > currentPage) {
            console.log(`Chuyển sang trang ${pageNum}...`);
            await button.click();
            await sleep(1000);
            return pageNum;
        }
    }
    console.log("Không còn trang tiếp theo.");
    return null;
};

// Main scraping functions
const scrapeTruyenList = async (): Promise<void> => {
    console.log("Bắt đầu scrape danh sách truyện...");
    const browser = await puppeteer.launch({ headless: true });
    
    try {
        let currentPage = 1;
        let page = await browser.newPage();
        await page.goto(SEARCH_URL);

        while (true) {
            console.log(`📄 Đang scrape trang ${currentPage}...`);
            await page.waitForSelector('.book-item', { visible: true });

            const truyenData = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.book-item')).map((truyen: any) => ({
                    cover: truyen.querySelector('.cover-col a.cover-wrapper img')?.src || "",
                    source: truyen.querySelector('.tooltipped')?.getAttribute('href') || ""
                }));
            });

            const filepath = path.join(OUTPUT_DIR, `${currentPage}.json`);
            await fs.mkdir(OUTPUT_DIR, { recursive: true });

            for (const [index, truyen] of truyenData.entries()) {
                const truyenUrl = `${BASE_URL}${truyen.source}`;
                const filepath = path.join(OUTPUT_DIR, `page${currentPage}_truyen${index + 1}.json`);
                
                console.log(`📖 Đang xử lý truyện ${index + 1}/${truyenData.length} trên trang ${currentPage}`);
                
                const detail = await getTruyenDetail(truyenUrl);
                if (detail) {
                    detail.covers = truyen.cover;
                    detail.chapters = await saveEveryChapter(detail.chapters, []);
                    await saveData(detail, filepath);
                }
            }

            const nextPageNum = await getNextPage(page, 'li.waves-effect a', currentPage);
            if (!nextPageNum || nextPageNum === 2) break;
            
            currentPage = nextPageNum;
            await page.close();
            page = await browser.newPage();
            await page.goto(SEARCH_URL);
        }
    } catch (error) {
        console.error(`❌ Lỗi khi scrape danh sách: ${error.message}`);
    } finally {
        await browser.close();
        console.log("✔ Hoàn tất scrape danh sách truyện");
    }
};

const getTruyenDetail = async (url: string): Promise<any> => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        
        const isLocked = await page.evaluate(() => !!document.querySelector('#formVerifyCode, #modalManagerPermission'));
        if (isLocked) {
            console.warn(`⚠ Truyện tại ${url} bị khóa`);
            return null;
        }

        await Promise.all([
            page.waitForSelector('.cover-info', { timeout: 10000 }),
            page.waitForSelector('.book-desc-detail', { timeout: 10000 })
        ]);

        const storyInfo = await page.evaluate(() => ({
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

        return storyInfo;
    } catch (error) {
        console.error(`❌ Lỗi khi lấy chi tiết truyện ${url}: ${error.message}`);
        return null;
    } finally {
        await browser.close();
    }
};

const getChapterContent = async (url: string): Promise<any> => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#bookContent');

        const content = await page.evaluate(() => ({
            title_chapter: document.querySelector('p.book-title:nth-of-type(2)')?.textContent?.trim() || "",
            content: document.querySelector('#bookContentBody')?.textContent?.trim() || ""
        }));

        return content;
    } catch (error) {
        console.error(`❌ Lỗi khi lấy nội dung chương ${url}: ${error.message}`);
        return null;
    } finally {
        await browser.close();
    }
};

const saveEveryChapter = async (chapters: any[], results: any[]): Promise<any[]> => {
    for (const [index, chapter] of chapters.entries()) {
        try {
            console.log(`📖 Đang xử lý chương ${index + 1} - ${chapter.title}`);
            const content = await getChapterContent(`${BASE_URL}${chapter.link}`);
            if (content) results.push(content);
        } catch (error) {
            console.error(`❌ Lỗi khi lưu chương ${chapter.title}: ${error.message}`);
        }
    }
    return results;
};

// Run the scraper
scrapeTruyenList().catch(error => {
    console.error("❌ Lỗi không xử lý được:", error);
});