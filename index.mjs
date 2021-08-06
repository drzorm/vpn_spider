import { $, cd, argv, fs } from "zx";
import clipboardy from "clipboardy";
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const intl = new Intl.DateTimeFormat("zh", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const latestFilePath = resolve(__dirname, "./.latest");

cd(__dirname);

if (argv.push) await $`git pull`;

const latest = (() => {
  if (!fs.existsSync(latestFilePath)) {
    const date = new Date();
    date.setDate(date.getDate() - 3);
    fs.writeFileSync(latestFilePath, date.toISOString(), "utf8");

    return date;
  }

  let date = fs.readFileSync(latestFilePath, "utf8");
  return date ? new Date(date) : new Date();
})();

const link = "https://www.mattkaydiary.com/search/label/vpn?max-results=50";

const browser = await chromium.launch({
  proxy: {
    server: "socks5://127.0.0.1:10808",
  },
});
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(link, { timeout: 300000 });
let posts = await page.evaluate(() => {
  const $main = document.querySelector("#main");
  const $posts = $main.querySelectorAll(".blog-posts .post");
  return Array.from($posts).map((post) => {
    const $link = post.querySelector(".post-title a");
    const $date = post.querySelector(".published");
    return {
      title: $link.textContent.trim(),
      href: $link.href,
      date: new Date($date.title),
    };
  });
});


posts = posts.filter((post) => post.date > latest);

const vpns = [];

for await (const post of posts) {
  console.log(`[${intl.format(post.date)}]${post.title}`);
  await page.goto(post.href, { timeout: 300000 });
  const vpn = await page.evaluate(() => {
    const content = document.querySelector(".post-body").innerHTML;
    return content.match(/(ss|trojan|vmess):[^<]+/g) || [];
  });

  vpns.push(...vpn);
}

if (vpns.length) {
  const txt = vpns.join("\n");
  clipboardy.writeSync(txt);
  fs.writeFileSync(resolve(__dirname, "./vpns.txt"), txt, "utf8");

  // 生成订阅链接
  fs.writeFileSync(resolve(__dirname, "./rss"), Buffer.from(txt, "utf8").toString("base64"), "utf8");
}

if (posts.length) {
  fs.writeFileSync(latestFilePath, posts[0]?.date.toISOString(), "utf8");
}

console.log(`已抓取到 ${vpns.length} 个节点, 已复制到剪切板`);

await browser.close();

if (argv.push) {
  await $`git add .`;
  const { stdout } = await $`git diff --name-only --cached`;
  const files = stdout.trim().split("\n").filter(Boolean);

  if (files.length) {
    await $`git commit -m ${"update " + files.join()}`;
    await $`git push`;
  }
}

process.on("uncaughtException", () => {
  browser?.close?.();
  process.exit();
});
