# caso 29: [E] wiki-zh
ferramenta: read_page
argumentos: {"url":"https://zh.wikipedia.org/wiki/Linux","maxChars":4000}
nota do teste: chines (CJK)
status HTTP: 200 | tempo: 1118 ms | isError: false
sinais: chars=4228 tabelas=1 cercas=0 truncado=true mojibake=false cjk=true rtl=false links=49

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 29,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Linux - 维基百科，自由的百科全书\nURL: https://zh.wikipedia.org/wiki/Linux\nConteudo: 138079 caracteres (exibidos 4119)\n\n跳转到内容\n\n![本页使用了标题或全文手工转换](https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/Zh_conversion_icon_m.svg/40px-Zh_conversion_icon_m.svg.png?utm_source=zh.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)\n\n维基百科，自由的百科全书\n\n[![](https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/Disambig_gray.svg/40px-Disambig_gray.svg.png?utm_source=zh.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://zh.wikipedia.org/wiki/Wikipedia:%E6%B6%88%E6%AD%A7%E4%B9%89)此條目介紹的是Linux操作系统。关于Linux内核本身，请见「**[Linux核心](https://zh.wikipedia.org/wiki/Linux%E6%A0%B8%E5%BF%83)**」。关于名為「Linux」的小行星，请见「**[小行星9885](https://zh.wikipedia.org/wiki/%E5%B0%8F%E8%A1%8C%E6%98%9F9885)**」。\n\n Linux\n\n| [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/3/35/Tux.svg/250px-Tux.svg.png?utm_source=zh.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://zh.wikipedia.org/wiki/File:Tux.svg) [Tux](https://zh.wikipedia.org/wiki/Tux)是Linux官方的[吉祥物](https://zh.wikipedia.org/wiki/%E5%90%89%E7%A5%A5%E7%89%A9)，於1996年由[Larry Ewing](https://zh.wikipedia.org/wiki/Larry_Ewing)創造 | |\n| --- | --- |\n| [开发者](https://zh.wikipedia.org/wiki/%E8%BD%AF%E4%BB%B6%E8%AE%BE%E8%AE%A1%E5%B8%88) | 社区贡献者，包括创始人[林納斯·托瓦茲](https://zh.wikipedia.org/wiki/%E6%9E%97%E7%B4%8D%E6%96%AF%C2%B7%E6%89%98%E7%93%A6%E8%8C%B2) |\n| [编程语言](https://zh.wikipedia.org/wiki/%E7%BC%96%E7%A8%8B%E8%AF%AD%E8%A8%80) | [C语言](https://zh.wikipedia.org/wiki/C%E8%AF%AD%E8%A8%80)、[汇编语言](https://zh.wikipedia.org/wiki/%E6%B1%87%E7%BC%96%E8%AF%AD%E8%A8%80) [Rust](https://zh.wikipedia.org/wiki/Rust%E8%AA%9E%E8%A8%80)（自6.1版起） [1] |\n| 作業系統家族 | [類Unix系統](https://zh.wikipedia.org/wiki/%E9%A1%9EUnix%E7%B3%BB%E7%B5%B1) |\n| 運作狀態 | 支援中 |\n| 源码模式 | [自由及开放源代码软件](https://zh.wikipedia.org/wiki/%E8%87%AA%E7%94%B1%E5%8F%8A%E5%BC%80%E6%94%BE%E6%BA%90%E4%BB%A3%E7%A0%81%E8%BD%AF%E4%BB%B6) |\n| 首次发布 | 1991年的0.01版（代號“Freax”） |\n| [最新預覽](https://zh.wikipedia.org/wiki/%E8%BB%9F%E9%AB%94%E7%89%88%E6%9C%AC%E9%80%B1%E6%9C%9F) | Kernel: 6.15-rc6[2]（2025年5月11日，​16個月前​（2025-05-11））[[±]](https://zh.wikipedia.org/w/index.php?title=Template:Latest_preview_software_release/Linux&action=edit) |\n| 市場取向 | 桌面、服务器、嵌入式设备、移动设备等 |\n| 支持的[语言](https://zh.wikipedia.org/wiki/%E8%87%AA%E7%84%B6%E8%AF%AD%E8%A8%80) | 多種 |\n| 支援平台 | [Alpha](https://zh.wikipedia.org/wiki/DEC_Alpha), [ARC](https://zh.wikipedia.org/wiki/ARC_(%E5%A4%84%E7%90%86%E5%99%A8)), [ARM](https://zh.wikipedia.org/wiki/ARM_architecture), [Hexagon](https://zh.wikipedia.org/wiki/Qualcomm_Hexagon), [Itanium](https://zh.wikipedia.org/wiki/Itanium), [LoongArch](https://zh.wikipedia.org/wiki/LoongArch), [m68k](https://zh.wikipedia.org/wiki/%E6%91%A9%E6%89%98%E7%BD%97%E6%8B%89_68000), [MicroBlaze](https://zh.wikipedia.org/w/index.php?title=MicroBlaze&action=edit&redlink=1)（英语：[MicroBlaze](https://en.wikipedia.org/wiki/MicroBlaze)）, [MIPS](https://zh.wikipedia.org/wiki/MIPS_architecture), [Nios II](https://zh.wikipedia.org/wiki/Nios_II), [OpenRISC](https://zh.wikipedia.org/w/index.php?title=OpenRISC&action=edit&redlink=1)（英语：[OpenRISC](https://en.wikipedia.org/wiki/OpenRISC)）, [PA-RISC](https://zh.wikipedia.org/wiki/PA-RISC), [PowerPC](https://zh.wikipedia.org/wiki/PowerPC), [RISC-V](https://zh.wikipedia.org/wiki/RISC-V), [S390](https://zh.wikipedia.org/w/index.php?title=IBM%E4%BC%81%E4%B8%9A%E7%B3%BB%E7%BB%9F%E6%9E%B6%E6%9E%84&action=edit&redlink=1)（英语：[IBM Enterprise Systems Architecture](https://en.wikipedia.org/wiki/IBM_Enterprise_Systems_Architecture)）, [SuperH](https://zh.wikipedia.org/wiki/SuperH)、[SPARC](https://zh.wikipedia.org/wiki/SPARC), [x86](https://zh.wikipedia.org/wiki/X86)(含[x86-64](https://zh.wikipedia.org/wiki/X86-64)), [Xtensa](https://zh.wikipedia.org/w/index.php?title=Tensilica&action=edit&redlink=1)（英语：[Tensilica](https://en.wikipedia.org/wiki/Tensilica)）等 |\n| [内核](https://zh.wikipedia.org/wiki/%E5%86%85%E6%A0%B8)类别 | [整塊性核心](https://zh.wikipedia.org/wiki/%E6%95%B4%E5%A1%8A%E6%80%A7%E6%A0%B8%E5%BF%83) |\n| 默认[用户界面](https://zh.wikipedia.org/wiki/%E7%94%A8%E6%88%B7%E7%95%8C%E9%9D\n\n[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# Linux - 维基百科，自由的百科全书
URL: https://zh.wikipedia.org/wiki/Linux
Conteudo: 138079 caracteres (exibidos 4119)

跳转到内容

![本页使用了标题或全文手工转换](https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/Zh_conversion_icon_m.svg/40px-Zh_conversion_icon_m.svg.png?utm_source=zh.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)

维基百科，自由的百科全书

[![](https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/Disambig_gray.svg/40px-Disambig_gray.svg.png?utm_source=zh.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://zh.wikipedia.org/wiki/Wikipedia:%E6%B6%88%E6%AD%A7%E4%B9%89)此條目介紹的是Linux操作系统。关于Linux内核本身，请见「**[Linux核心](https://zh.wikipedia.org/wiki/Linux%E6%A0%B8%E5%BF%83)**」。关于名為「Linux」的小行星，请见「**[小行星9885](https://zh.wikipedia.org/wiki/%E5%B0%8F%E8%A1%8C%E6%98%9F9885)**」。

 Linux

| [![](https://thumb.wikimedia.org/wikipedia/commons/thumb/3/35/Tux.svg/250px-Tux.svg.png?utm_source=zh.wikipedia.org&utm_campaign=parser&utm_content=thumbnail)](https://zh.wikipedia.org/wiki/File:Tux.svg) [Tux](https://zh.wikipedia.org/wiki/Tux)是Linux官方的[吉祥物](https://zh.wikipedia.org/wiki/%E5%90%89%E7%A5%A5%E7%89%A9)，於1996年由[Larry Ewing](https://zh.wikipedia.org/wiki/Larry_Ewing)創造 | |
| --- | --- |
| [开发者](https://zh.wikipedia.org/wiki/%E8%BD%AF%E4%BB%B6%E8%AE%BE%E8%AE%A1%E5%B8%88) | 社区贡献者，包括创始人[林納斯·托瓦茲](https://zh.wikipedia.org/wiki/%E6%9E%97%E7%B4%8D%E6%96%AF%C2%B7%E6%89%98%E7%93%A6%E8%8C%B2) |
| [编程语言](https://zh.wikipedia.org/wiki/%E7%BC%96%E7%A8%8B%E8%AF%AD%E8%A8%80) | [C语言](https://zh.wikipedia.org/wiki/C%E8%AF%AD%E8%A8%80)、[汇编语言](https://zh.wikipedia.org/wiki/%E6%B1%87%E7%BC%96%E8%AF%AD%E8%A8%80) [Rust](https://zh.wikipedia.org/wiki/Rust%E8%AA%9E%E8%A8%80)（自6.1版起） [1] |
| 作業系統家族 | [類Unix系統](https://zh.wikipedia.org/wiki/%E9%A1%9EUnix%E7%B3%BB%E7%B5%B1) |
| 運作狀態 | 支援中 |
| 源码模式 | [自由及开放源代码软件](https://zh.wikipedia.org/wiki/%E8%87%AA%E7%94%B1%E5%8F%8A%E5%BC%80%E6%94%BE%E6%BA%90%E4%BB%A3%E7%A0%81%E8%BD%AF%E4%BB%B6) |
| 首次发布 | 1991年的0.01版（代號“Freax”） |
| [最新預覽](https://zh.wikipedia.org/wiki/%E8%BB%9F%E9%AB%94%E7%89%88%E6%9C%AC%E9%80%B1%E6%9C%9F) | Kernel: 6.15-rc6[2]（2025年5月11日，​16個月前​（2025-05-11））[[±]](https://zh.wikipedia.org/w/index.php?title=Template:Latest_preview_software_release/Linux&action=edit) |
| 市場取向 | 桌面、服务器、嵌入式设备、移动设备等 |
| 支持的[语言](https://zh.wikipedia.org/wiki/%E8%87%AA%E7%84%B6%E8%AF%AD%E8%A8%80) | 多種 |
| 支援平台 | [Alpha](https://zh.wikipedia.org/wiki/DEC_Alpha), [ARC](https://zh.wikipedia.org/wiki/ARC_(%E5%A4%84%E7%90%86%E5%99%A8)), [ARM](https://zh.wikipedia.org/wiki/ARM_architecture), [Hexagon](https://zh.wikipedia.org/wiki/Qualcomm_Hexagon), [Itanium](https://zh.wikipedia.org/wiki/Itanium), [LoongArch](https://zh.wikipedia.org/wiki/LoongArch), [m68k](https://zh.wikipedia.org/wiki/%E6%91%A9%E6%89%98%E7%BD%97%E6%8B%89_68000), [MicroBlaze](https://zh.wikipedia.org/w/index.php?title=MicroBlaze&action=edit&redlink=1)（英语：[MicroBlaze](https://en.wikipedia.org/wiki/MicroBlaze)）, [MIPS](https://zh.wikipedia.org/wiki/MIPS_architecture), [Nios II](https://zh.wikipedia.org/wiki/Nios_II), [OpenRISC](https://zh.wikipedia.org/w/index.php?title=OpenRISC&action=edit&redlink=1)（英语：[OpenRISC](https://en.wikipedia.org/wiki/OpenRISC)）, [PA-RISC](https://zh.wikipedia.org/wiki/PA-RISC), [PowerPC](https://zh.wikipedia.org/wiki/PowerPC), [RISC-V](https://zh.wikipedia.org/wiki/RISC-V), [S390](https://zh.wikipedia.org/w/index.php?title=IBM%E4%BC%81%E4%B8%9A%E7%B3%BB%E7%BB%9F%E6%9E%B6%E6%9E%84&action=edit&redlink=1)（英语：[IBM Enterprise Systems Architecture](https://en.wikipedia.org/wiki/IBM_Enterprise_Systems_Architecture)）, [SuperH](https://zh.wikipedia.org/wiki/SuperH)、[SPARC](https://zh.wikipedia.org/wiki/SPARC), [x86](https://zh.wikipedia.org/wiki/X86)(含[x86-64](https://zh.wikipedia.org/wiki/X86-64)), [Xtensa](https://zh.wikipedia.org/w/index.php?title=Tensilica&action=edit&redlink=1)（英语：[Tensilica](https://en.wikipedia.org/wiki/Tensilica)）等 |
| [内核](https://zh.wikipedia.org/wiki/%E5%86%85%E6%A0%B8)类别 | [整塊性核心](https://zh.wikipedia.org/wiki/%E6%95%B4%E5%A1%8A%E6%80%A7%E6%A0%B8%E5%BF%83) |
| 默认[用户界面](https://zh.wikipedia.org/wiki/%E7%94%A8%E6%88%B7%E7%95%8C%E9%9D

[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```