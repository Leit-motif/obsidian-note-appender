import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	inputFolder: string;
	outputFolder: string;
	autoGenerate: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	inputFolder: '5.0 Journal/5.1 Daily',
	outputFolder: '5.0 Journal/5.3 Monthly',
	autoGenerate: false
}

export default class MonthlyRecapPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// Add a ribbon icon
		this.addRibbonIcon('calendar', 'Generate Monthly Recap', (evt: MouseEvent) => {
			this.generateMonthlyRecap();
		});

		// Add a command
		this.addCommand({
			id: 'generate-monthly-recap',
			name: 'Generate Monthly Recap',
			callback: () => {
				this.generateMonthlyRecap();
			}
		});

		// Add settings tab
		this.addSettingTab(new MonthlyRecapSettingTab(this.app, this));

		// Add auto-generation check
		this.registerInterval(
			window.setInterval(() => this.checkAutoGenerate(), 3600000) // Check every hour
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async generateMonthlyRecap() {
		const vault = this.app.vault;
		const dailyNotesFolder = this.settings.inputFolder;

		// Get all files in the daily notes folder
		const dailyNotes = vault.getFiles().filter(file => 
			file.path.startsWith(dailyNotesFolder) && file.extension === 'md'
		);

		// Group files by year and month
		const groupedNotes = this.groupNotesByYearAndMonth(dailyNotes);

		for (const [yearMonth, files] of Object.entries(groupedNotes)) {
			const [year, month] = yearMonth.split('-');
			const outputFileName = `${year}-${month}.md`;
			const outputFilePath = `${this.settings.outputFolder}/${outputFileName}`;

			let recapContent = '';
			for (const file of files) {
				const content = await vault.read(file);
				const cleanedContent = this.cleanFileContent(content);
				recapContent += cleanedContent + '\n\n';
			}

			// Create or update the recap file
			const existingFile = vault.getAbstractFileByPath(outputFilePath);
			if (existingFile instanceof TFile) {
				await vault.modify(existingFile, recapContent);
			} else {
				await vault.create(outputFilePath, recapContent);
			}
		}

		new Notice('Monthly recap generated successfully!');
	}

	groupNotesByYearAndMonth(files: TFile[]): Record<string, TFile[]> {
		const grouped: Record<string, TFile[]> = {};
		for (const file of files) {
			const match = file.name.match(/^(\d{4})-(\d{2})-\d{2}/);
			if (match) {
				const [, year, month] = match;
				const key = `${year}-${month}`;
				if (!grouped[key]) {
					grouped[key] = [];
				}
				grouped[key].push(file);
			}
		}
		return grouped;
	}

	cleanFileContent(content: string): string {
		// Remove Dailies block
		content = content.replace(/# Dailies\s*\n(?:- \[[ x]\] .*\n?)*/g, '');

		// Remove calendar-nav block
		content = content.replace(/---\s*\n```calendar-nav\n```/g, '');

		// Remove Daily Law block
		content = content.replace(/# Daily Law\s*\n(?:- \[[ x]\] .*\n?)*/g, '');

		return content;
	}

	checkAutoGenerate() {
		if (this.settings.autoGenerate) {
			const now = new Date();
			if (now.getDate() === 1 && now.getHours() === 0) {
				this.generateMonthlyRecap();
			}
		}
	}
}

class MonthlyRecapSettingTab extends PluginSettingTab {
	plugin: MonthlyRecapPlugin;

	constructor(app: App, plugin: MonthlyRecapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Input Folder')
			.setDesc('Folder path for daily notes')
			.addText(text => text
				.setPlaceholder('Example: folder1/folder2')
				.setValue(this.plugin.settings.inputFolder)
				.onChange(async (value) => {
					this.plugin.settings.inputFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Output Folder')
			.setDesc('Folder path for monthly recap files')
			.addText(text => text
				.setPlaceholder('Example: folder1/folder2')
				.setValue(this.plugin.settings.outputFolder)
				.onChange(async (value) => {
					this.plugin.settings.outputFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto Generate')
			.setDesc('Automatically generate recap for the previous month on the first day of each month')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoGenerate)
				.onChange(async (value) => {
					this.plugin.settings.autoGenerate = value;
					await this.plugin.saveSettings();
				}));
	}
}
