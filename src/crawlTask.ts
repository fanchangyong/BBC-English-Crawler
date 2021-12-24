import * as fs from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Timeout } from '@nestjs/schedule';
import axios from 'axios';
import cheerio from 'cheerio';

const BASE_URL = 'https://www.bbc.co.uk';
const FILE_NAME = 'phrases.json';

type Phrase = {
  id: string;
  title: string;
  url: string;
  imageURL: string;
  desc?: string;
  sentences?: string[];
};

@Injectable()
export class CrawlTask {
  private readonly logger = new Logger(CrawlTask.name);

  getIdFromLink(link: string): string {
    const lastIndex = link.lastIndexOf('/ep-');
    const id = link.substring(lastIndex + 4);
    return id;
  }

  getExistingPhrasesMap() {
    let phrases: Phrase[] = [];
    try {
      const content = fs.readFileSync(FILE_NAME, 'utf8');
      phrases = JSON.parse(content) as Phrase[];
    } catch {}

    const phrasesMap = phrases.reduce((acc, cur) => {
      acc[cur.id] = cur;
      return acc;
    }, {});
    return phrasesMap;
  }

  async getPhrases(): Promise<Phrase[]> {
    const res = await axios.get(
      `${BASE_URL}/learningenglish/chinese/features/todays-phrase`,
    );

    const phrases: Phrase[] = [];
    const $ = cheerio.load(res.data);
    $('.course-content-item').each((i, el) => {
      const link = $(el).find('.text h2 a').first().attr('href');
      const id = this.getIdFromLink(link);
      const url = `${BASE_URL}${link}`;
      const imageURL = $(el).find('.img a img').first().attr('src');
      const title = $(el).find('.text h2 a').first().text();
      console.log('title: ', title, ', link: ', link);
      const phrase = {
        id,
        title,
        url,
        imageURL,
      };
      phrases.push(phrase);
    });
    return phrases;
  }

  async getPhraseDetail(url: string, phrase: Phrase) {
    console.log('## getting detail from: ', url);
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    const desc = $('.widget-richtext .text p').first().text();
    const sentences = [];
    $('h3:contains(例句) ~ p').each((i, el) => {
      const html = $(el).html();
      const sentence = html.replace('<br>', '\n');
      sentences.push(sentence);
    });
    phrase.desc = desc;
    phrase.sentences = sentences;
  }

  @Timeout(3)
  async handleCron() {
    this.logger.debug('Crawl task called');

    const existingPhrasesMap = this.getExistingPhrasesMap();

    let phrases = await this.getPhrases();

    // Fill existing phrase details
    phrases = phrases.map((phrase) => {
      const { id } = phrase;
      const existingPhrase = existingPhrasesMap[id];
      return {
        ...phrase,
        ...existingPhrase,
      };
    });

    console.log('got phrases: ', phrases);
    for (const phrase of phrases) {
      const { id, url } = phrase;
      const existingPhrase = existingPhrasesMap[id];
      if (!existingPhrase || !existingPhrase.desc) {
        try {
          await this.getPhraseDetail(url, phrase);
        } catch (error) {
          console.log('get phrase detail error: ', error);
        }
        console.log('phrase detail: ', phrase);
      }
      fs.writeFileSync('phrases.json', JSON.stringify(phrases, null, 4));
    }
  }
}
