import { Calendar } from 'lucide-react';

export default function CalendarPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
        <Calendar className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-bold mb-2">Calendar</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        Coming soon. This page will show a read-only calendar view from your
        connected calendars, reminders, and todos.
      </p>
    </div>
  );
}
