# caso 32: [E] emoji-unicode
ferramenta: read_page
argumentos: {"url":"https://www.unicode.org/emoji/charts/full-emoji-list.html","maxChars":6000}
nota do teste: emojis e simbolos
status HTTP: 200 | tempo: 2266 ms | isError: false
sinais: chars=6252 tabelas=5 cercas=0 truncado=true mojibake=false cjk=false rtl=false links=50

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 32,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Full Emoji List, v18.0\nURL: https://www.unicode.org/emoji/charts/full-emoji-list.html\nConteudo: 206845 caracteres (exibidos 6119)\n\n[![[Unicode]](https://www.unicode.org/webscripts/logo60s2.gif)](https://www.unicode.org/)[Emoji Charts](https://www.unicode.org/emoji/charts/index.html)\n\n[**Adopt a Character**\n![AAC Animation](https://www.unicode.org/consortium/images/aac-some-sponsors.gif)](https://www.unicode.org/consortium/adopt-a-character.html)\n\n# Full Emoji List, v18.0\n\n[Index & Help](https://www.unicode.org/emoji/charts/index.html) | [Images & Rights](https://www.unicode.org/emoji/images.html) | [Spec](https://www.unicode.org/reports/tr51/) | [Proposing Additions](https://www.unicode.org/emoji/proposals.html)\n\nThis chart provides a list of the Unicode emoji characters and sequences, with images from different vendors, CLDR name, date, source, and keywords. The ordering of the emoji and the annotations are based on [Unicode CLDR data](https://cldr.unicode.org/#TOC-What-is-CLDR-). Emoji sequences have more than one code point in the **Code** column. [Recently-added emoji](https://www.unicode.org/emoji/charts/emoji-released.html) are marked by a ⊛ in the name and outlined images; their images may show as a group with “…” before and after.\n\nEmoji with skin-tones are not listed here: see [Full Skin Tone List](https://www.unicode.org/emoji/charts/full-emoji-modifiers.html).\n\nFor counts of emoji, see [Emoji Counts](https://www.unicode.org/emoji/charts/emoji-counts.html).\n\nWhile these charts use a particular version of the [Unicode Emoji data files](https://www.unicode.org/Public/18.0.0/emoji/), the images and format may be updated at any time. For any production usage, consult those data files. For information about the contents of each column, such as the **CLDR Short Name**, click on the column header. For further information, see [Index & Help](https://www.unicode.org/emoji/charts/index.html).\n\n| Smileys & Emotion | | | | | | | | |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| face-smiling | | | | | | | | |\n| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](https://www.unicode.org/emoji/format.html#col-vendor) | [CLDR Short Name](https://www.unicode.org/emoji/format.html#col-name) |\n| 1 | U+1F600 | 😀 | | | — | — | — | grinning face |\n| 2 | U+1F603 | 😃 | | | | | | grinning face with big eyes |\n| 3 | U+1F604 | 😄 | | | | — | — | grinning face with smiling eyes |\n| 4 | U+1F601 | 😁 | | | | | | beaming face with smiling eyes |\n| 5 | U+1F606 | 😆 | | | — | | — | grinning squinting face |\n| 6 | U+1F605 | 😅 | | | — | | — | grinning face with sweat |\n| 7 | U+1F923 | 🤣 | | — | — | — | — | rolling on the floor laughing |\n| 8 | U+1F602 | 😂 | | | | — | | face with tears of joy |\n| 9 | U+1F642 | 🙂 | | | — | — | — | slightly smiling face |\n| 10 | U+1F643 | 🙃 | | — | — | — | — | upside-down face |\n| 11 | U+1FAE0 | 🫠 | | — | — | — | — | melting face |\n| 12 | U+1FAEB | 🫫 | | — | — | — | — | ⊛ cracking face |\n| 13 | U+1F609 | 😉 | | | | | | winking face |\n| 14 | U+1F60A | 😊 | | | | — | | smiling face with smiling eyes |\n| 15 | U+1F607 | 😇 | | — | — | — | — | smiling face with halo |\n| face-affection | | | | | | | | |\n| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](https://www.unicode.org/emoji/format.html#col-vendor) | [CLDR Short Name](https://www.unicode.org/emoji/format.html#col-name) |\n| 16 | U+1F970 | 🥰 | | — | — | — | — | smiling face with hearts |\n| 17 | U+1F60D | 😍 | | | | | | smiling face with heart-eyes |\n| 18 | U+1F929 | 🤩 | | — | — | — | — | star-struck |\n| 19 | U+1F618 | 😘 | | | | — | | face blowing a kiss |\n| 20 | U+1F617 | 😗 | | — | — | — | — | kissing face |\n| 21 | U+263A | ☺ | | | | — | | smiling face |\n| 22 | U+1F61A | 😚 | | | | — | | kissing face with closed eyes |\n| 23 | U+1F619 | 😙 | | — | — | — | — | kissing face with smiling eyes |\n| 24 | U+1F972 | 🥲 | | — | — | — | — | smiling face with tear |\n| face-tongue | | | | | | | | |\n| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](https://www.unicode.org/emoji/format.html#col-vendor) | [CLDR Short Name](https://www.unicode.org/emoji/format.html#col-name) |\n| 25 | U+1F60B | 😋 | | | — | | — | face savoring food |\n| 26 | U+1F61B | 😛 | | — | — | — | — | face with tongue |\n| 27 | U+1F61C | 😜 | | | | | | winking face with tongue |\n| 28 | U+1F92A | 🤪 | | — | — | — | — | zany face |\n| 29 | U+1F61D | 😝 | | | | — | — | squinting face with tongue |\n| 30 | U+1F911 | 🤑 | | — | — | — | — | money-mouth face |\n| face-hand | | | | | | | | |\n| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](http\n\n[... conteudo truncado em 6000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# Full Emoji List, v18.0
URL: https://www.unicode.org/emoji/charts/full-emoji-list.html
Conteudo: 206845 caracteres (exibidos 6119)

[![[Unicode]](https://www.unicode.org/webscripts/logo60s2.gif)](https://www.unicode.org/)[Emoji Charts](https://www.unicode.org/emoji/charts/index.html)

[**Adopt a Character**
![AAC Animation](https://www.unicode.org/consortium/images/aac-some-sponsors.gif)](https://www.unicode.org/consortium/adopt-a-character.html)

# Full Emoji List, v18.0

[Index & Help](https://www.unicode.org/emoji/charts/index.html) | [Images & Rights](https://www.unicode.org/emoji/images.html) | [Spec](https://www.unicode.org/reports/tr51/) | [Proposing Additions](https://www.unicode.org/emoji/proposals.html)

This chart provides a list of the Unicode emoji characters and sequences, with images from different vendors, CLDR name, date, source, and keywords. The ordering of the emoji and the annotations are based on [Unicode CLDR data](https://cldr.unicode.org/#TOC-What-is-CLDR-). Emoji sequences have more than one code point in the **Code** column. [Recently-added emoji](https://www.unicode.org/emoji/charts/emoji-released.html) are marked by a ⊛ in the name and outlined images; their images may show as a group with “…” before and after.

Emoji with skin-tones are not listed here: see [Full Skin Tone List](https://www.unicode.org/emoji/charts/full-emoji-modifiers.html).

For counts of emoji, see [Emoji Counts](https://www.unicode.org/emoji/charts/emoji-counts.html).

While these charts use a particular version of the [Unicode Emoji data files](https://www.unicode.org/Public/18.0.0/emoji/), the images and format may be updated at any time. For any production usage, consult those data files. For information about the contents of each column, such as the **CLDR Short Name**, click on the column header. For further information, see [Index & Help](https://www.unicode.org/emoji/charts/index.html).

| Smileys & Emotion | | | | | | | | |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| face-smiling | | | | | | | | |
| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](https://www.unicode.org/emoji/format.html#col-vendor) | [CLDR Short Name](https://www.unicode.org/emoji/format.html#col-name) |
| 1 | U+1F600 | 😀 | | | — | — | — | grinning face |
| 2 | U+1F603 | 😃 | | | | | | grinning face with big eyes |
| 3 | U+1F604 | 😄 | | | | — | — | grinning face with smiling eyes |
| 4 | U+1F601 | 😁 | | | | | | beaming face with smiling eyes |
| 5 | U+1F606 | 😆 | | | — | | — | grinning squinting face |
| 6 | U+1F605 | 😅 | | | — | | — | grinning face with sweat |
| 7 | U+1F923 | 🤣 | | — | — | — | — | rolling on the floor laughing |
| 8 | U+1F602 | 😂 | | | | — | | face with tears of joy |
| 9 | U+1F642 | 🙂 | | | — | — | — | slightly smiling face |
| 10 | U+1F643 | 🙃 | | — | — | — | — | upside-down face |
| 11 | U+1FAE0 | 🫠 | | — | — | — | — | melting face |
| 12 | U+1FAEB | 🫫 | | — | — | — | — | ⊛ cracking face |
| 13 | U+1F609 | 😉 | | | | | | winking face |
| 14 | U+1F60A | 😊 | | | | — | | smiling face with smiling eyes |
| 15 | U+1F607 | 😇 | | — | — | — | — | smiling face with halo |
| face-affection | | | | | | | | |
| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](https://www.unicode.org/emoji/format.html#col-vendor) | [CLDR Short Name](https://www.unicode.org/emoji/format.html#col-name) |
| 16 | U+1F970 | 🥰 | | — | — | — | — | smiling face with hearts |
| 17 | U+1F60D | 😍 | | | | | | smiling face with heart-eyes |
| 18 | U+1F929 | 🤩 | | — | — | — | — | star-struck |
| 19 | U+1F618 | 😘 | | | | — | | face blowing a kiss |
| 20 | U+1F617 | 😗 | | — | — | — | — | kissing face |
| 21 | U+263A | ☺ | | | | — | | smiling face |
| 22 | U+1F61A | 😚 | | | | — | | kissing face with closed eyes |
| 23 | U+1F619 | 😙 | | — | — | — | — | kissing face with smiling eyes |
| 24 | U+1F972 | 🥲 | | — | — | — | — | smiling face with tear |
| face-tongue | | | | | | | | |
| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](https://www.unicode.org/emoji/format.html#col-vendor) | [CLDR Short Name](https://www.unicode.org/emoji/format.html#col-name) |
| 25 | U+1F60B | 😋 | | | — | | — | face savoring food |
| 26 | U+1F61B | 😛 | | — | — | — | — | face with tongue |
| 27 | U+1F61C | 😜 | | | | | | winking face with tongue |
| 28 | U+1F92A | 🤪 | | — | — | — | — | zany face |
| 29 | U+1F61D | 😝 | | | | — | — | squinting face with tongue |
| 30 | U+1F911 | 🤑 | | — | — | — | — | money-mouth face |
| face-hand | | | | | | | | |
| [№](https://www.unicode.org/emoji/format.html#col-num) | [Code](https://www.unicode.org/emoji/format.html#col-code) | [Browser](https://www.unicode.org/emoji/format.html#col-browser) | [Sample](https://www.unicode.org/emoji/format.html#col-vendor) | [GMail](https://www.unicode.org/emoji/format.html#col-vendor) | [SB](https://www.unicode.org/emoji/format.html#col-vendor) | [DCM](https://www.unicode.org/emoji/format.html#col-vendor) | [KDDI](http

[... conteudo truncado em 6000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```