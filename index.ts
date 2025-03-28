import puppeteer, { Page } from 'puppeteer';
import { Browser } from 'puppeteer';
import { fileURLToPath } from 'url';
import * as fsp from 'node:fs/promises';
import fs from "fs"
import axios from "axios";
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// const url = 'https://truyenwikidich.net/tim-kiem?qs=1&gender=5794f03dd7ced228f4419198&tc=&tf=0&m=3&y=2025&q=';
const url = 'https://truyenwikidich.net/tim-kiem?qs=1&gender=5794f03dd7ced228f4419198&m=3&so=4&y=2025&vo=1#'
const BaseURL = 'https://truyenwikidich.net'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const saveData = async(data: any[], outputFile: string) => {
    fsp.writeFile(outputFile, JSON.stringify(data, null, 2), 'utf-8');
};
const saveAppendData = async(data: any[], outputFile: string) => {
    fsp.appendFile(outputFile, JSON.stringify(data, null, 2), 'utf-8');
};
const nextPage = async (page: Page, typeEffect:string, currentPage: number) => {
    const pageButtons = await page.$$(typeEffect);

    for (const button of pageButtons) {
        const pageNumber = await page.evaluate(el => parseInt((el as HTMLElement).innerText.trim(), 10), button);
        console.log(`📖 Tìm thấy page: ${pageNumber}...`);
        if (!isNaN(pageNumber) && pageNumber > currentPage) {
            console.log(`Chuyển sang trang ${pageNumber}...`);
            await button.click();
            await sleep(2000);

            return pageNumber; // Cập nhật số trang mới
        }
    }

    console.log("Không còn trang tiếp theo.");
    return null; // Hết trang
};
const getTruyenList = async () => {
    console.log("Bắt đầu Puppeteer...");

    const browser: Browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url);
    
    let hasNextPage = true;
    let currentPage = 1;

    while(hasNextPage){
        console.log(`📄 Đang scrape trang ${currentPage}...`);

        await page.waitForSelector('.book-item', { visible: true });

        const truyenData = await page.evaluate(() => {
            const truyen_list = Array.from(document.querySelectorAll('.book-item'));
            
            const data = truyen_list.map((truyen: any) => ({
                title: truyen.querySelector('.book-title')?.innerText.trim() || "Không có tiêu đề",
                author: truyen.querySelector('.book-author a.truncate')?.innerText.trim() || "Không có tác giả",
                cover: truyen.querySelector('.cover-col a.cover-wrapper img')?.src || "Không có ảnh",
                gender: truyen.querySelector('.book-gender')?.innerText.trim() || "Không có thể loại chính",
                status: truyen.querySelectorAll('.book-publisher a.truncate')?.[1]?.innerText.trim() || "Không có thể loại chính",
                source: truyen.querySelector('.tooltipped')?.getAttribute('href') || "Không có source",
            
            }));

            return data;
        });
        saveData(truyenData,"truyen-data.json");
        // await new Promise(resolve => setTimeout(resolve, 1000));

        const typeEffect ='li.waves-effect a';
        const newPage = await nextPage(page,typeEffect,currentPage);
        if(newPage===null) break;
        currentPage = newPage;
    }
    // Lưu truyện 
    
    console.log("💾 Toàn bộ thông tin cơ bản đã được lưu vào truyen-data.json");
    await browser.close();
};
const getAllChapters = async (page: Page) => {
    let allChapters = [];
    let currentPage = 1; // Giả sử bắt đầu từ trang 1

    while (true) {
        console.log(`📖 Lấy chương từ trang ${currentPage}...`);

        try {
            // Chờ selector trong 30 giây, nếu không có thì báo lỗi và bỏ qua
            await page.waitForSelector('li.chapter-name a.truncate', { timeout: 30000 });
        } catch (error) {
            console.warn(`⚠ Không tìm thấy danh sách chương trên trang ${currentPage}, bỏ qua...`);
            break; // Nếu không tìm thấy, có thể đã hết chương => thoát vòng lặp
        }

        const chapters = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('li.chapter-name a.truncate'))
                .map(a => ({
                    title: (a as HTMLElement).innerText.trim(),
                    link: (a as HTMLElement).getAttribute('href')
                }));
        });

        allChapters = allChapters.concat(chapters);

        // Chuyển sang trang tiếp theo
        const typeEffect = 'li.waves-effect a[data-action="loadBookIndex"]';
        const newPage = await nextPage(page, typeEffect, currentPage);
        if (newPage === null) break; // Nếu hết trang thì dừng
        currentPage = newPage; // Cập nhật số trang
    }

    return allChapters;
};

const MAX_CONCURRENT_TABS = 5;
const chapter_list = async (truyenUrl: string, filename:string) => {
    console.log("Bắt đầu Puppeteer...");

    const browser: Browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(truyenUrl, { waitUntil: 'domcontentloaded' });

        // Kiểm tra xem có yêu cầu nhập mã xác minh hoặc quyền truy cập không
        const isLocked = await page.evaluate(() => {
            return document.querySelector('#formVerifyCode') || document.querySelector('#modalManagerPermission');
        });

        if (isLocked) {
            console.warn(`⚠ Truyện tại ${truyenUrl} yêu cầu xác minh hoặc bị khóa, bỏ qua...`);
            await browser.close();
            return; // Skip truyện này
        }

        await page.waitForSelector('.cover-info', { timeout: 10000 });
        await page.waitForSelector('.book-desc-detail', { timeout: 10000 });

        const storyInfo = await page.evaluate(() => {
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerText.trim() : null;
            };
            const getGenres = () => {
                return Array.from(document.querySelectorAll('.book-desc span a'))
                            .map(a => (a as HTMLElement).innerText.trim());
            };

            return {
                title: getText('.cover-info h2'),
                views: getText('.book-stats:nth-of-type(1) span'),
                stars: getText('.book-stats:nth-of-type(2) span'),
                comments: getText('.book-stats:nth-of-type(3) span'),
                hanViet: getText('.cover-info p:nth-of-type(2) a'),
                author: getText('.cover-info p:nth-of-type(3) a'),
                status: getText('.cover-info p:nth-of-type(4) a'),
                latestChapter: getText('.cover-info p:nth-of-type(5) a'),
                lastUpdate: getText('.cover-info p:nth-of-type(6) span'),
                thanks: getText('.cover-info p:nth-of-type(7) span'),
                genres: getGenres(),
                description: getText('.book-desc-detail'),
                chapters: [],
            };
        });

        const chapters = await getAllChapters(page);
        storyInfo.chapters = chapters;

        saveData([storyInfo], filename);
        console.log(`💾 Lưu thông tin truyện vào ${filename}`);

    } catch (error) {
        console.error(`❌ Lỗi khi lấy truyện ${truyenUrl}: ${(error as Error).message}`);
    } finally {
        await browser.close();
    }
};


const eachChapterInfo = async (chapterUrl:string, truyenName:string) => {
    console.log("Bắt đầu Puppeteer...");

    const browser: Browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(chapterUrl, { waitUntil: 'domcontentloaded' });
    
    await page.waitForSelector('#bookContent');
    
    const chapterInfo = await page.evaluate(() => {
        const getText = (selector) => {
            const el = document.querySelector(selector);
            return el ? el.innerText.trim() : null;
        };
        
        return {
            title: getText('p.book-title:nth-of-type(1)'),
            title_chapter: getText('p.book-title:nth-of-type(2)'),
            author: getText('p.book-title:nth-of-type(3)'),
            content: getText('#bookContentBody'),
        };
    });
    
    saveAppendData ([chapterInfo],truyenName);
    console.log("💾 Lưu thành công!");
    
    await sleep(1000);

    await browser.close();
};


const saveCover = async (listTruyenURL) => {
    const rawData = fs.readFileSync(listTruyenURL,'utf-8');
    const jsonData = JSON.parse(rawData);

    jsonData.forEach((truyen,index) => {
        console.log(`📖 Truyện ${index + 1}: ${truyen.title}`);
        console.log(`📖 Url ${truyen.cover}`);
        const match = truyen.cover.match(/\/([^\/]+)$/);
        if(match&&match[1])
        {
            const imageName = match[1] + ".jpg";
            downloadImage(truyen.cover,imageName);
        }
        else{
            console.error(`❌ Không thể lấy tên file từ URL: ${truyen.cover}`);
        }
        
    });
};

// lưu thông tin về chapter của tất cả truyện
const saveChapters = async (listTruyenURL: string) => {
    try {
        const rawData = await fs.promises.readFile(listTruyenURL, 'utf-8');
        const jsonData = JSON.parse(rawData);
        const response = await axios({ url, responseType: "stream" });
        

        for (const [index, truyen] of jsonData.entries()) {
            const truyenURL = BaseURL + truyen.source;
            console.log(`📖 Truyện ${index + 1}: ${truyen.title}`);
            console.log(`📖 Url ${truyenURL}`);

            const match = truyenURL.match(/\/([^\/]+)$/);
            const filename = match[1]+ ".json";
            const filePath = path.join(__dirname, "truyen-data", filename);
            
            await chapter_list(truyenURL, filePath); // Đợi hoàn thành trước khi tiếp tục
            
        }
    } catch (error) {
        console.error(`❌ Lỗi khi lưu chapter: ${(error as Error).message}`);
    }
};

// lưu thông tin về tất cả chapter của một truyện
const saveEveryChapter = async (listChapterURL: string) => {
    try {
        // lấy thông tin json của bộ truyện - cụ thể là json được lưu ở truyen-data
        const rawData = await fs.promises.readFile(listChapterURL, 'utf-8');
        const truyenData = JSON.parse(rawData);
        const chapters = truyenData[0].chapters;

        const match = listChapterURL.match(/\/([^\/]+)$/);
        const filename = match[1];
        const filePath = path.join(__dirname, "chapter-data", filename); // nơi lưu chapter
            
        console.log(`📖 Truyện ${truyenData[0].title}`);
        for (const [index, chapter] of chapters.entries()) {
            const chapterURL = BaseURL + chapter.link; // source chapter
            console.log(`📖 Chapter ${index + 1} -  ${chapter.title}`);
            console.log(`📖 Url ${chapterURL}`);
            await eachChapterInfo(chapterURL, filePath); // Đợi hoàn thành trước khi tiếp tục
            
        }
    } catch (error) {
        console.error(`❌ Lỗi khi lưu chapter: ${(error as Error).message}`);
    }
};
// lưu tất cả chapter của tất cả truyện
const saveEveryChapterOfAll = async (listTruyenURL: string) => {
    try {
        const rawData = await fs.promises.readFile(listTruyenURL, 'utf-8');
        const jsonData = JSON.parse(rawData);
        for (const [index, truyen] of jsonData.entries()) {
            const truyenURL = truyen.source;
            const match = truyenURL.match(/\/([^\/]+)$/);
            const filename = match[1]+ ".json";
            const filePath = path.join(__dirname, "truyen-data", filename);

            console.log(`📖 Truyện ${index + 1}: ${truyen.title}`);
            if(index<8) continue;
            console.log(`📖 Path ${filePath}`);
            await saveEveryChapter(filePath); // Đợi hoàn thành trước khi tiếp tục
            
        }
    } catch (error) {
        console.error(`❌ Lỗi khi lưu chapter: ${(error as Error).message}`);
    }
};

const downloadImage = async (url: string, filename: string) => {
    try {
        const response = await axios({ url, responseType: "stream" });
        const filePath = path.join(__dirname, "covers", filename);

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on("finish", ()=>resolve);
            writer.on("error", reject);
        });

        console.log(`✔ Ảnh đã tải: ${filename}`);
    } catch (error) {
        console.error(`❌ Lỗi tải ảnh ${filename}:`, error.message);
    }
};


// truyen_list()
// saveCover('truyen-data.json');
// saveChapters('truyen-data.json');
saveEveryChapterOfAll('truyen-data.json');