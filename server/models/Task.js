class Task {

    constructor(data) {

        this.id = data.id;
        this.title = data.title;
        this.description = data.description;
        this.assigned_to = data.assigned_to;
        this.assigned_by = data.assigned_by;
        this.status = data.status;
        this.priority = data.priority;
        this.due_date = data.due_date;
        this.completed_at = data.completed_at;
        this.feedback = data.feedback;

    }

}

module.exports = Task;