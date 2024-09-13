import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, Modal } from 'obsidian';
import { startOfWeek, endOfWeek, format } from 'date-fns';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	inputFolder: string;
	outputFolder: string;
	autoGenerateMonthly: boolean;
	weeklyInputFolder: string;
	weeklyOutputFolder: string;
	autoGenerateWeekly: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	inputFolder: '5.0 Journal/5.1 Daily',
	outputFolder: '5.0 Journal/5.3 Monthly',
	autoGenerateMonthly: false,
	weeklyInputFolder: '5.0 Journal/5.1 Daily',
	weeklyOutputFolder: '5.0 Journal/5.2 Weekly',
	autoGenerateWeekly: false
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
		// Remove YAML frontmatter
		content = content.replace(/^---\n[\s\S]*?\n---\n/, '');

		// Remove Dailies block
		content = content.replace(/# Dailies\s*\n(?:- \[[ x]\] .*\n?)*/g, '');

		// Remove calendar-nav block (updated to remove the entire block)
		content = content.replace(/```calendar-nav[\s\S]*?```/g, '');

		// Remove Daily Law block
		content = content.replace(/# Daily Law\s*\n(?:- \[[ x]\] .*\n?)*/g, '');

		return content.trim(); // Trim any leading/trailing whitespace
	}

	async generateWeeklyRecap() {
		const vault = this.app.vault;
		const dailyNotesFolder = this.settings.weeklyInputFolder;

		// Get all files in the daily notes folder
		const dailyNotes = vault.getFiles().filter(file => 
			file.path.startsWith(dailyNotesFolder) && file.extension === 'md'
		);

		// Group files by week
		const groupedNotes = this.groupNotesByWeek(dailyNotes);

		for (const [weekStart, files] of Object.entries(groupedNotes)) {
			const weekEnd = endOfWeek(new Date(weekStart), { weekStartsOn: 0 });
			const outputFileName = `${format(new Date(weekStart), 'yyyy-MM-dd')}_${format(weekEnd, 'yyyy-MM-dd')}.md`;
			const outputFilePath = `${this.settings.weeklyOutputFolder}/${outputFileName}`;

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

		new Notice('Weekly recaps generated successfully!');
	}

	groupNotesByWeek(files: TFile[]): Record<string, TFile[]> {
		const grouped: Record<string, TFile[]> = {};
		for (const file of files) {
			const match = file.name.match(/^(\d{4}-\d{2}-\d{2})/);
			if (match) {
				const date = new Date(match[1]);
				const weekStart = startOfWeek(date, { weekStartsOn: 0 });
				const key = format(weekStart, 'yyyy-MM-dd');
				if (!grouped[key]) {
					grouped[key] = [];
				}
				grouped[key].push(file);
			}
		}
		return grouped;
	}

	checkAutoGenerate() {
		if (this.settings.autoGenerateMonthly) {
			const now = new Date();
			if (now.getDate() === 1 && now.getHours() === 0) {
				this.generateMonthlyRecap();
			}
		}
		if (this.settings.autoGenerateWeekly) {
			const now = new Date();
			if (now.getDay() === 0 && now.getHours() === 0) {
				this.generateWeeklyRecap();
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

		containerEl.createEl('h2', {text: 'Monthly Recap Settings'});

		new Setting(containerEl)
			.setName('Input Folder')
			.setDesc('Folder path for daily notes')
			.addText(text => text
				.setPlaceholder('Example: folder1/folder2')
				.setValue(this.plugin.settings.inputFolder)
				.onChange(async (value) => {
					this.plugin.settings.inputFolder = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Choose Directory')
				.onClick(() => {
					new FolderSuggestModal(this.app, (folder) => {
						this.plugin.settings.inputFolder = folder.path;
						this.plugin.saveSettings();
						this.display();
					}).open();
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
				}))
			.addButton(button => button
				.setButtonText('Choose Directory')
				.onClick(() => {
					new FolderSuggestModal(this.app, (folder) => {
						this.plugin.settings.outputFolder = folder.path;
						this.plugin.saveSettings();
						this.display();
					}).open();
				}));

		new Setting(containerEl)
			.setName('Auto Generate')
			.setDesc('Automatically generate recap for the previous month on the first day of each month')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoGenerateMonthly)
				.onChange(async (value) => {
					this.plugin.settings.autoGenerateMonthly = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Generate Monthly Recap')
			.setDesc('Generate a monthly recap for all months')
			.addButton(button => button
				.setButtonText('Generate')
				.onClick(async () => {
					await this.plugin.generateMonthlyRecap();
					new Notice('Monthly recap generated successfully!');
				}));

		containerEl.createEl('h2', {text: 'Weekly Recap Settings'});

		new Setting(containerEl)
			.setName('Weekly Input Folder')
			.setDesc('Folder path for daily notes (for weekly recap)')
			.addText(text => text
				.setPlaceholder('Example: folder1/folder2')
				.setValue(this.plugin.settings.weeklyInputFolder)
				.onChange(async (value) => {
					this.plugin.settings.weeklyInputFolder = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Choose Directory')
				.onClick(() => {
					new FolderSuggestModal(this.app, (folder) => {
						this.plugin.settings.weeklyInputFolder = folder.path;
						this.plugin.saveSettings();
						this.display();
					}).open();
				}));

		new Setting(containerEl)
			.setName('Weekly Output Folder')
			.setDesc('Folder path for weekly recap files')
			.addText(text => text
				.setPlaceholder('Example: folder1/folder2')
				.setValue(this.plugin.settings.weeklyOutputFolder)
				.onChange(async (value) => {
					this.plugin.settings.weeklyOutputFolder = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Choose Directory')
				.onClick(() => {
					new FolderSuggestModal(this.app, (folder) => {
						this.plugin.settings.weeklyOutputFolder = folder.path;
						this.plugin.saveSettings();
						this.display();
					}).open();
				}));

		new Setting(containerEl)
			.setName('Auto Generate Weekly')
			.setDesc('Automatically generate recap for the previous week on Sunday')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoGenerateWeekly)
				.onChange(async (value) => {
					this.plugin.settings.autoGenerateWeekly = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Generate Weekly Recap')
			.setDesc('Generate a weekly recap for all weeks')
			.addButton(button => button
				.setButtonText('Generate')
				.onClick(async () => {
					await this.plugin.generateWeeklyRecap();
					new Notice('Weekly recap generated successfully!');
				}));
	}
}

class FolderSuggestModal extends Modal {
	private result: (folder: TFolder) => void;
	private input: HTMLInputElement;

	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.result = onChoose;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Choose a folder" });

		this.input = contentEl.createEl("input", {
			type: "text",
			value: ""
		});

		const folderList = contentEl.createEl("ul");
		const folders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];

		folders.forEach(folder => {
			const item = folderList.createEl("li");
			item.setText(folder.path);
			item.onClickEvent(() => {
				this.result(folder);
				this.close();
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
