import type { LinkPage } from './types';

/** amy.bo/~martin. `seed` is Linktree's click count up to 2 October 2026 (linktr.ee/MartinCurrie). */
const page: LinkPage = {
	handle: 'martin',
	name: 'Martin Currie',
	contactUrl: 'https://contact.andeye.com/?source=amy.bo%2F~martin&subject=Message%20for%20Martin%20Currie',
	rel: ['https://mas.to/@Aqueum'],
	sections: [
		{
			links: [{ slug: 'patreon', label: 'Patreon', url: 'https://patreon.com/AMYBO', icon: 'patreon', seed: 7 }],
		},
		{
			title: 'AMYBO - sustainable protein for all',
			links: [
				{ slug: 'amybo', label: 'AMYBO', url: 'https://amybo.org/', icon: 'amybo', seed: 6 },
				{ slug: 'amybo-youtube', label: 'AMYBO YouTube', url: 'https://youtube.com/@amybo', icon: 'youtube', seed: 8 },
				{ slug: 'amybo-links', label: 'More AMYBO links', url: 'https://linktr.ee/amybo.org', icon: 'linktree', seed: 3 },
			],
		},
		{
			title: 'andeye - software & photography',
			links: [
				{ slug: 'andeye', label: 'andeye - productivity software', url: 'https://www.andeye.com/', icon: 'software', seed: 1 },
				{ slug: 'andeye-photo', label: 'andeye Photography', url: 'https://andeye.photo/', icon: 'camera', seed: 5 },
			],
		},
		{
			title: 'Aqueum - water quality & treatment',
			links: [
				{ slug: 'aqueum', label: 'Aqueum', url: 'https://www.aqueum.com/', icon: 'water', seed: 6 },
				{ slug: 'aqueum-cv', label: 'Aqueum CV', url: 'https://aqueum.com/people/martin-currie/', icon: 'cv', seed: 19 },
			],
		},
		{
			title: 'Stuff',
			links: [
				{ slug: 'music', label: 'Music to work to', url: 'https://ambi4.work/', icon: 'music', seed: 12 },
				{ slug: 'wishlist', label: "Wish list - stuff I'd like but haven't yet got", url: 'https://gowish.com/s/dxn7bg', icon: 'gift', seed: 15 },
			],
		},
		{
			title: 'Socials',
			links: [
				{ slug: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/martincurrie/', icon: 'linkedin', seed: 12 },
				{ slug: 'x', label: 'X - rarely checked', url: 'https://twitter.com/martin_currie', icon: 'x', seed: 4 },
				{ slug: 'mastodon', label: 'Mastodon - rarely checked', url: 'https://mas.to/@Aqueum', icon: 'mastodon', seed: 3 },
				{ slug: 'zotero', label: 'Zotero', url: 'https://www.zotero.org/martincurrie', icon: 'zotero', seed: 9 },
				{ slug: 'qrz', label: 'MM7MMU on QRZ.com', url: 'https://www.qrz.com/db/MM7MMU', icon: 'radio', seed: 4 },
			],
		},
		{
			title: 'Email',
			links: [{ slug: 'email', label: 'Get in touch', url: 'https://contact.andeye.com/?source=amy.bo%2F~martin&subject=Message%20for%20Martin%20Currie', icon: 'mail' }],
		},
	],
};

export default page;
