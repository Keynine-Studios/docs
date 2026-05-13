const fs = require("fs");
const path = require("path");

const TARGET = "After the release of Top 10! 2.0 and the UI refresh, the video in this article may be out of date. The steps should work the same but if you have any troubles, please create a ticket!";

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(fullPath);
    } else if (entry.name.endsWith(".mdx")) {
      let content = fs.readFileSync(fullPath, "utf8");
      if (content.includes(TARGET) && !content.includes("<Warning>")) {
        content = content.replace(TARGET, `<Warning>\n${TARGET}\n</Warning>`);
        fs.writeFileSync(fullPath, content);
        console.log(`✓ Fixed: ${fullPath}`);
      }
    }
  }
}

processDir("./topten");
console.log("Done.");