# caso 9: [A] arxiv-abs
ferramenta: read_page
argumentos: {"url":"https://arxiv.org/abs/1706.03762","maxChars":4000}
nota do teste: abstract de paper
status HTTP: 200 | tempo: 280 ms | isError: false
sinais: chars=4320 tabelas=1 cercas=0 truncado=true mojibake=false cjk=false rtl=false links=30

## resposta crua (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# [1706.03762] Attention Is All You Need\nURL: https://arxiv.org/abs/1706.03762\nDescricao: Abstract page for arXiv paper 1706.03762: Attention Is All You Need\nConteudo: 8242 caracteres (exibidos 4119)\n\nSkip to main content\n\n Press Enter to search · [Advanced search](https://arxiv.org/search/advanced)\n\n# Computer Science > Computation and Language\n\n **arXiv:1706.03762** (cs)\n\n [Submitted on 12 Jun 2017 ([v1](https://arxiv.org/abs/1706.03762v1)), last revised 2 Aug 2023 (this version, v7)]\n\n# Title:Attention Is All You Need\n\nAuthors:[Ashish Vaswani](https://arxiv.org/search/cs?searchtype=author&query=Vaswani,+A), [Noam Shazeer](https://arxiv.org/search/cs?searchtype=author&query=Shazeer,+N), [Niki Parmar](https://arxiv.org/search/cs?searchtype=author&query=Parmar,+N), [Jakob Uszkoreit](https://arxiv.org/search/cs?searchtype=author&query=Uszkoreit,+J), [Llion Jones](https://arxiv.org/search/cs?searchtype=author&query=Jones,+L), [Aidan N. Gomez](https://arxiv.org/search/cs?searchtype=author&query=Gomez,+A+N), [Lukasz Kaiser](https://arxiv.org/search/cs?searchtype=author&query=Kaiser,+L), [Illia Polosukhin](https://arxiv.org/search/cs?searchtype=author&query=Polosukhin,+I)\n\nView a PDF of the paper titled Attention Is All You Need, by Ashish Vaswani and 7 other authors\n\n [View PDF](https://arxiv.org/pdf/1706.03762) [HTML (experimental)](https://arxiv.org/html/1706.03762v7)\n> Abstract:The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles by over 2 BLEU. On the WMT 2014 English-to-French translation task, our model establishes a new single-model state-of-the-art BLEU score of 41.8 after training for 3.5 days on eight GPUs, a small fraction of the training costs of the best models from the literature. We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.\n\n| Comments: | 15 pages, 5 figures |\n| --- | --- |\n| Subjects: | Computation and Language (cs.CL); Machine Learning (cs.LG) |\n| Cite as: | [arXiv:1706.03762](https://arxiv.org/abs/1706.03762) [cs.CL] |\n| | (or [arXiv:1706.03762v7](https://arxiv.org/abs/1706.03762v7) [cs.CL] for this version) |\n| | [https://doi.org/10.48550/arXiv.1706.03762](https://doi.org/10.48550/arXiv.1706.03762) arXiv-issued DOI via DataCite |\n\n## Submission history\n\n From: Llion Jones [[view email](https://arxiv.org/show-email/f53b7360/1706.03762)]\n **[[v1]](https://arxiv.org/abs/1706.03762v1)** Mon, 12 Jun 2017 17:57:34 UTC (1,102 KB)\n **[[v2]](https://arxiv.org/abs/1706.03762v2)** Mon, 19 Jun 2017 16:49:45 UTC (1,125 KB)\n **[[v3]](https://arxiv.org/abs/1706.03762v3)** Tue, 20 Jun 2017 05:20:02 UTC (1,125 KB)\n **[[v4]](https://arxiv.org/abs/1706.03762v4)** Fri, 30 Jun 2017 17:29:30 UTC (1,124 KB)\n **[[v5]](https://arxiv.org/abs/1706.03762v5)** Wed, 6 Dec 2017 03:30:32 UTC (1,124 KB)\n **[[v6]](https://arxiv.org/abs/1706.03762v6)** Mon, 24 Jul 2023 00:48:54 UTC (1,124 KB)\n **[v7]** Wed, 2 Aug 2023 00:41:18 UTC (1,124 KB)\n\n Full-text links:\n\n## Access Paper:\n\n View a PDF of the paper titled Attention Is All You Need, by Ashish Vaswani and 7 other authors\n\n- [View PDF](https://arxiv.org/pdf/1706.03762)\n- [HTML (experimental)](https://arxiv.org/html/1706.03762v7)\n- [TeX Source ](https://arxiv.org/src/1706.03762)\n\n[view license](http://arxiv.org/licenses/nonexclusive-distrib/1.0/)\n\n### Current browse context:\n\ncs.CL\n\n [< prev](https://arxiv.org/prevnext?id=1706.03762&function=prev&context=cs.CL) | [next >](https://arxiv.org/prevnext?id=1706.03762&function=next&context=c\n\n[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]"
      }
    ]
  }
}
```

## texto extraido
```
# [1706.03762] Attention Is All You Need
URL: https://arxiv.org/abs/1706.03762
Descricao: Abstract page for arXiv paper 1706.03762: Attention Is All You Need
Conteudo: 8242 caracteres (exibidos 4119)

Skip to main content

 Press Enter to search · [Advanced search](https://arxiv.org/search/advanced)

# Computer Science > Computation and Language

 **arXiv:1706.03762** (cs)

 [Submitted on 12 Jun 2017 ([v1](https://arxiv.org/abs/1706.03762v1)), last revised 2 Aug 2023 (this version, v7)]

# Title:Attention Is All You Need

Authors:[Ashish Vaswani](https://arxiv.org/search/cs?searchtype=author&query=Vaswani,+A), [Noam Shazeer](https://arxiv.org/search/cs?searchtype=author&query=Shazeer,+N), [Niki Parmar](https://arxiv.org/search/cs?searchtype=author&query=Parmar,+N), [Jakob Uszkoreit](https://arxiv.org/search/cs?searchtype=author&query=Uszkoreit,+J), [Llion Jones](https://arxiv.org/search/cs?searchtype=author&query=Jones,+L), [Aidan N. Gomez](https://arxiv.org/search/cs?searchtype=author&query=Gomez,+A+N), [Lukasz Kaiser](https://arxiv.org/search/cs?searchtype=author&query=Kaiser,+L), [Illia Polosukhin](https://arxiv.org/search/cs?searchtype=author&query=Polosukhin,+I)

View a PDF of the paper titled Attention Is All You Need, by Ashish Vaswani and 7 other authors

 [View PDF](https://arxiv.org/pdf/1706.03762) [HTML (experimental)](https://arxiv.org/html/1706.03762v7)
> Abstract:The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles by over 2 BLEU. On the WMT 2014 English-to-French translation task, our model establishes a new single-model state-of-the-art BLEU score of 41.8 after training for 3.5 days on eight GPUs, a small fraction of the training costs of the best models from the literature. We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.

| Comments: | 15 pages, 5 figures |
| --- | --- |
| Subjects: | Computation and Language (cs.CL); Machine Learning (cs.LG) |
| Cite as: | [arXiv:1706.03762](https://arxiv.org/abs/1706.03762) [cs.CL] |
| | (or [arXiv:1706.03762v7](https://arxiv.org/abs/1706.03762v7) [cs.CL] for this version) |
| | [https://doi.org/10.48550/arXiv.1706.03762](https://doi.org/10.48550/arXiv.1706.03762) arXiv-issued DOI via DataCite |

## Submission history

 From: Llion Jones [[view email](https://arxiv.org/show-email/f53b7360/1706.03762)]
 **[[v1]](https://arxiv.org/abs/1706.03762v1)** Mon, 12 Jun 2017 17:57:34 UTC (1,102 KB)
 **[[v2]](https://arxiv.org/abs/1706.03762v2)** Mon, 19 Jun 2017 16:49:45 UTC (1,125 KB)
 **[[v3]](https://arxiv.org/abs/1706.03762v3)** Tue, 20 Jun 2017 05:20:02 UTC (1,125 KB)
 **[[v4]](https://arxiv.org/abs/1706.03762v4)** Fri, 30 Jun 2017 17:29:30 UTC (1,124 KB)
 **[[v5]](https://arxiv.org/abs/1706.03762v5)** Wed, 6 Dec 2017 03:30:32 UTC (1,124 KB)
 **[[v6]](https://arxiv.org/abs/1706.03762v6)** Mon, 24 Jul 2023 00:48:54 UTC (1,124 KB)
 **[v7]** Wed, 2 Aug 2023 00:41:18 UTC (1,124 KB)

 Full-text links:

## Access Paper:

 View a PDF of the paper titled Attention Is All You Need, by Ashish Vaswani and 7 other authors

- [View PDF](https://arxiv.org/pdf/1706.03762)
- [HTML (experimental)](https://arxiv.org/html/1706.03762v7)
- [TeX Source ](https://arxiv.org/src/1706.03762)

[view license](http://arxiv.org/licenses/nonexclusive-distrib/1.0/)

### Current browse context:

cs.CL

 [< prev](https://arxiv.org/prevnext?id=1706.03762&function=prev&context=cs.CL) | [next >](https://arxiv.org/prevnext?id=1706.03762&function=next&context=c

[... conteudo truncado em 4000 caracteres. Peca o restante com maxChars maior, ou use extract_links para navegar ...]
```